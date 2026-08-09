import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { dbQuery, dbExecute } from '@/lib/db-server'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Entities created while their model was still 'draft' never get a
// schema_deployment row (see upsertSchemaDeployment in api/entities/route.ts,
// which only fires when the model is already 'active' at entity-creation
// time). When the model later becomes active, sweep up anything that was
// skipped - otherwise those entities stay stuck: status 'draft' in the UI,
// but invisible on /deploy's schema tab forever, since nothing ever
// retries the upsert for them.
async function backfillSchemaDeploymentForModel(modelId: number) {
  await dbExecute(
    `INSERT INTO mds_meta.schema_deployment (entity_id, status, created_at)
     SELECT e.id, 'pending', GETUTCDATE()
     FROM mds_meta.entity e
     WHERE e.model_id = @modelId
       AND NOT EXISTS (SELECT 1 FROM mds_meta.schema_deployment sd WHERE sd.entity_id = e.id)`,
    { modelId }
  )
}

interface Model {
  id: number
  code: string
  name: string
  description: string | null
  version: number
  status: string
  source_database: string | null
  target_schema: string | null
  created_at: string
  created_by: string
  updated_at: string | null
  updated_by: string | null
}

// GET /api/models/[modelId] - Get single model
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'GET /api/models/[modelId]')
  
  try {
    const results = await dbQuery<Model>(
      'SELECT * FROM mds_meta.model WHERE id = @id',
      { id: parseInt(modelId) }
    )
    
    if (results.length === 0) {
      return NextResponse.json(
        { error: 'Model not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(results[0])
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to fetch model')
    return NextResponse.json(
      { error: 'Failed to fetch model' },
      { status: 500 }
    )
  }
}

// PUT /api/models/[modelId] - Update model
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'PUT /api/models/[modelId]')
  
  try {
    const body = await request.json()
    const { name, description, status, source_database, target_schema } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const queryParams: Record<string, unknown> = { id: parseInt(modelId) }
    
    if (name !== undefined) {
      updates.push('name = @name')
      queryParams.name = name
    }
    if (description !== undefined) {
      updates.push('description = @description')
      queryParams.description = description
    }
    if (status !== undefined) {
      updates.push('status = @status')
      queryParams.status = status
    }
    if (source_database !== undefined) {
      updates.push('source_database = @source_database')
      queryParams.source_database = source_database
    }
    if (target_schema !== undefined) {
      updates.push('target_schema = @target_schema')
      queryParams.target_schema = target_schema
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
      `UPDATE mds_meta.model SET ${updates.join(', ')} WHERE id = @id`,
      queryParams
    )

    // Note: Status cascade to entities removed - entity status is now controlled via schema deployment.
    // Still needed: sweep up entities that were created while this model was
    // draft (see backfillSchemaDeploymentForModel above).
    if (status === 'active') {
      await backfillSchemaDeploymentForModel(parseInt(modelId))
    }

    return NextResponse.json({
      model_id: modelId,
      updated_at: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to update model')
    return NextResponse.json(
      { error: 'Failed to update model' },
      { status: 500 }
    )
  }
}

// DELETE /api/models/[modelId] - Delete model
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'DELETE /api/models/[modelId]')
  
  try {
    // Check if model has entities
    const entities = await dbQuery<{count: number}>(
      'SELECT COUNT(*) as count FROM mds_meta.entity WHERE model_id = @id',
      { id: parseInt(modelId) }
    )
    
    if (entities[0].count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete model with existing entities. Delete entities first.' },
        { status: 400 }
      )
    }
    
    await dbExecute(
      'DELETE FROM mds_meta.model WHERE id = @id',
      { id: parseInt(modelId) }
    )
    
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to delete model')
    return NextResponse.json(
      { error: 'Failed to delete model' },
      { status: 500 }
    )
  }
}
