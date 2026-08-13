import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { requireAdmin } from '@/lib/authz'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper: UPSERT schema_deployment for entity (only if model is active)
async function upsertSchemaDeployment(entityId: number) {
  // Check if model is active
  const modelCheck = await dbQuery<{ model_status: string }>(
    `SELECT m.status AS model_status 
     FROM mds_meta.entity e 
     JOIN mds_meta.model m ON m.id = e.model_id 
     WHERE e.id = @entityId`,
    { entityId }
  )
  
  if (modelCheck.length > 0 && modelCheck[0].model_status === 'active') {
    // UPSERT: Insert or update if exists
    await dbExecute(
      `MERGE mds_meta.schema_deployment AS target
       USING (SELECT @entityId AS entity_id) AS source
       ON target.entity_id = source.entity_id
       WHEN MATCHED THEN
         UPDATE SET updated_at = GETUTCDATE(), status = 'pending'
       WHEN NOT MATCHED THEN
         INSERT (entity_id, status, created_at) VALUES (@entityId, 'pending', GETUTCDATE());`,
      { entityId }
    )
    logger.info({ entityId }, 'Created/updated schema_deployment entry')
  }
}

interface Entity {
  id: number
  code: string
  name: string
  description: string | null
  model_id: number
  scd_type: 'SCD1' | 'SCD2'
  status: string
}

interface Attribute {
  id: number
  code: string
  name: string
  data_type: string
  is_required: boolean
  is_business_key: boolean
  sort_order: number
}

// GET /api/entities/[entityId] - Get single entity with attributes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'GET /api/entities/[entityId]')
  
  try {
    const entities = await dbQuery<Entity>(
      'SELECT * FROM mds_meta.entity WHERE id = @id',
      { id: parseInt(entityId) }
    )
    
    if (entities.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }
    
    const entity = entities[0]
    
    // Get attributes for this entity
    const attributes = await dbQuery<Attribute>(
      `SELECT id, code, name, data_type, is_required, is_business_key, sort_order
       FROM mds_meta.attribute 
       WHERE entity_id = @entityId
       ORDER BY sort_order`,
      { entityId: parseInt(entityId) }
    )
    
    return NextResponse.json({
      ...entity,
      attributes,
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to fetch entity')
    return NextResponse.json(
      { error: 'Failed to fetch entity' },
      { status: 500 }
    )
  }
}

// PUT /api/entities/[entityId] - Update entity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'PUT /api/entities/[entityId]')
  
  try {
    const body = await request.json()
    const { name, description, scd_type, status } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const queryParams: Record<string, unknown> = { id: parseInt(entityId) }
    
    if (name !== undefined) {
      updates.push('name = @name')
      queryParams.name = name
    }
    if (description !== undefined) {
      updates.push('description = @description')
      queryParams.description = description
    }
    if (scd_type !== undefined) {
      updates.push('scd_type = @scd_type')
      queryParams.scd_type = scd_type
    }
    if (status !== undefined) {
      updates.push('status = @status')
      queryParams.status = status
    }
    
    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }
    
    // Always update updated_at and updated_by
    updates.push('updated_at = GETUTCDATE()')
    updates.push('updated_by = @updated_by')
    queryParams.updated_by = 'admin'
    
    await dbExecute(
      `UPDATE mds_meta.entity SET ${updates.join(', ')} WHERE id = @id`,
      queryParams
    )
    
    // UPSERT schema_deployment if model is active
    await upsertSchemaDeployment(parseInt(entityId))
    
    return NextResponse.json({
      entity_id: entityId,
      updated_at: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to update entity')
    return NextResponse.json(
      { error: 'Failed to update entity' },
      { status: 500 }
    )
  }
}

// DELETE /api/entities/[entityId] - Delete entity
//
// Only genuinely *outstanding* work blocks deletion: uncommitted staged
// records, and commits still in flight (draft/pending/approved - not yet
// deployed or rejected). Everything else is history - already-deployed
// staged records, terminal (deployed/rejected) commits, and deployment_log
// entries - is cleaned up automatically as part of the delete, since it has
// no further use once the entity itself is gone. schema_deployment has
// ON DELETE CASCADE in the schema, so it needs no explicit cleanup here.
//
// Note: this does NOT drop the physical dbt-generated mds_master/mds_load
// tables for the entity (e.g. mds_master.<target_table>) - those are
// managed by dbt runs, not by this API, and may still hold historized
// data. Deleting the entity here only removes it from MDS metadata/staging.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'DELETE /api/entities/[entityId]')

  const authError = await requireAdmin()
  if (authError) return authError

  try {
    const id = parseInt(entityId)

    // Check if entity has attributes
    const attributes = await dbQuery<{ count: number }>(
      'SELECT COUNT(*) as count FROM mds_meta.attribute WHERE entity_id = @id',
      { id }
    )

    if (attributes[0].count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete entity with existing attributes. Delete attributes first.' },
        { status: 400 }
      )
    }

    // Uncommitted staged records are real in-progress work - block on those.
    // Already-loaded/deployed staged records have no commit left to lose and
    // are cleaned up below together with the rest of the history.
    const pendingRecords = await dbQuery<{ count: number }>(
      "SELECT COUNT(*) as count FROM mds_stage.staged_record WHERE entity_id = @id AND UPPER(status) = 'PENDING'",
      { id }
    )
    if (pendingRecords[0].count > 0) {
      return NextResponse.json(
        { error: `Cannot delete entity: ${pendingRecords[0].count} uncommitted staged record(s). Commit or discard them first.` },
        { status: 400 }
      )
    }

    // Commits still in flight are real outstanding work - block on those.
    // 'deployed' and 'rejected' are terminal and get cleaned up below.
    const [outstandingCommits, views, referencedBy] = await Promise.all([
      dbQuery<{ count: number }>(
        "SELECT COUNT(*) as count FROM mds_stage.[commit] WHERE entity_id = @id AND status NOT IN ('deployed', 'rejected')",
        { id }
      ),
      dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM mds_meta.entity_view WHERE entity_id = @id', { id }),
      dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM mds_meta.attribute WHERE reference_entity_id = @id', { id }),
    ])

    if (outstandingCommits[0].count > 0) {
      return NextResponse.json(
        { error: `Cannot delete entity: ${outstandingCommits[0].count} commit(s) still awaiting review or deployment.` },
        { status: 400 }
      )
    }
    if (views[0].count > 0) {
      return NextResponse.json(
        { error: `Cannot delete entity with ${views[0].count} view(s) defined on it. Delete the view(s) first.` },
        { status: 400 }
      )
    }
    if (referencedBy[0].count > 0) {
      return NextResponse.json(
        { error: `Cannot delete entity: ${referencedBy[0].count} attribute(s) on other entities reference it.` },
        { status: 400 }
      )
    }

    // Everything left is terminal history - clean it up, then delete the entity.
    await dbExecute('DELETE FROM mds_stage.staged_record WHERE entity_id = @id', { id })
    await dbExecute('DELETE FROM mds_load.deployment_log WHERE entity_id = @id', { id })
    await dbExecute("DELETE FROM mds_stage.[commit] WHERE entity_id = @id", { id })
    await dbExecute('DELETE FROM mds_meta.entity WHERE id = @id', { id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to delete entity')
    // Safety net for any FK constraint not covered by the checks above
    // (e.g. a future table added with a reference to entity.id) - still
    // report a clear 400 instead of crashing with a raw 500.
    const isFkViolation = error instanceof Error && 'number' in error && (error as { number?: number }).number === 547
    if (isFkViolation) {
      return NextResponse.json(
        { error: 'Cannot delete entity: other records still reference it.' },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to delete entity' },
      { status: 500 }
    )
  }
}
