import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

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
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'DELETE /api/entities/[entityId]')
  
  try {
    // Check if entity has attributes
    const attributes = await dbQuery<{ count: number }>(
      'SELECT COUNT(*) as count FROM mds_meta.attribute WHERE entity_id = @id',
      { id: parseInt(entityId) }
    )
    
    if (attributes[0].count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete entity with existing attributes. Delete attributes first.' },
        { status: 400 }
      )
    }
    
    // Check if entity has staged records
    const records = await dbQuery<{ count: number }>(
      'SELECT COUNT(*) as count FROM mds_stage.staged_record WHERE entity_id = @id',
      { id: parseInt(entityId) }
    )
    
    if (records[0].count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete entity with staged records. Delete or commit records first.' },
        { status: 400 }
      )
    }
    
    await dbExecute(
      'DELETE FROM mds_meta.entity WHERE id = @id',
      { id: parseInt(entityId) }
    )
    
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to delete entity')
    return NextResponse.json(
      { error: 'Failed to delete entity' },
      { status: 500 }
    )
  }
}
