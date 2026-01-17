import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Attribute {
  id: number
  entity_id: number
  entity_code?: string
  entity_name?: string
  model_id?: number
  model_status?: string
  code: string
  name: string
  description: string | null
  data_type: string
  sql_type: string | null
  max_length: number | null
  precision: number | null
  scale: number | null
  is_required: boolean
  is_business_key: boolean
  is_unique: boolean
  default_value: string | null
  reference_entity_id: number | null
  validation_regex: string | null
  sort_order: number
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

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

// GET /api/attributes/[attributeId] - Get single attribute
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'GET /api/attributes/[attributeId]')
  
  try {
    const results = await dbQuery<Attribute>(
      `SELECT 
        a.*,
        e.code AS entity_code,
        e.name AS entity_name,
        e.model_id,
        m.status AS model_status
       FROM mds_meta.attribute a
       JOIN mds_meta.entity e ON e.id = a.entity_id
       JOIN mds_meta.model m ON m.id = e.model_id
       WHERE a.id = @id`,
      { id: parseInt(attributeId) }
    )
    
    if (results.length === 0) {
      return NextResponse.json(
        { error: 'Attribute not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(results[0])
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to fetch attribute')
    return NextResponse.json(
      { error: 'Failed to fetch attribute' },
      { status: 500 }
    )
  }
}

// PUT /api/attributes/[attributeId] - Update attribute
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'PUT /api/attributes/[attributeId]')
  
  try {
    const body = await request.json()
    const { 
      name, 
      description,
      data_type,
      sql_type,
      max_length,
      precision,
      scale,
      is_required,
      is_business_key,
      is_unique,
      default_value,
      reference_entity_id,
      validation_regex,
      sort_order
    } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const queryParams: Record<string, unknown> = { id: parseInt(attributeId) }
    
    if (name !== undefined) {
      updates.push('name = @name')
      queryParams.name = name
    }
    if (description !== undefined) {
      updates.push('description = @description')
      queryParams.description = description
    }
    if (data_type !== undefined) {
      updates.push('data_type = @data_type')
      queryParams.data_type = data_type
    }
    if (sql_type !== undefined) {
      updates.push('sql_type = @sql_type')
      queryParams.sql_type = sql_type
    }
    if (max_length !== undefined) {
      updates.push('max_length = @max_length')
      queryParams.max_length = max_length
    }
    if (precision !== undefined) {
      updates.push('[precision] = @precision')
      queryParams.precision = precision
    }
    if (scale !== undefined) {
      updates.push('scale = @scale')
      queryParams.scale = scale
    }
    if (is_required !== undefined) {
      updates.push('is_required = @is_required')
      queryParams.is_required = is_required
    }
    if (is_business_key !== undefined) {
      updates.push('is_business_key = @is_business_key')
      queryParams.is_business_key = is_business_key
    }
    if (is_unique !== undefined) {
      updates.push('is_unique = @is_unique')
      queryParams.is_unique = is_unique
    }
    if (default_value !== undefined) {
      updates.push('default_value = @default_value')
      queryParams.default_value = default_value
    }
    if (reference_entity_id !== undefined) {
      updates.push('reference_entity_id = @reference_entity_id')
      queryParams.reference_entity_id = reference_entity_id
    }
    if (validation_regex !== undefined) {
      updates.push('validation_regex = @validation_regex')
      queryParams.validation_regex = validation_regex
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = @sort_order')
      queryParams.sort_order = sort_order
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
    
    // Get entity_id before update for schema_deployment
    const attrResult = await dbQuery<{ entity_id: number }>(
      'SELECT entity_id FROM mds_meta.attribute WHERE id = @id',
      { id: parseInt(attributeId) }
    )
    
    if (attrResult.length === 0) {
      return NextResponse.json(
        { error: 'Attribute not found' },
        { status: 404 }
      )
    }
    
    const entityId = attrResult[0].entity_id
    
    await dbExecute(
      `UPDATE mds_meta.attribute SET ${updates.join(', ')} WHERE id = @id`,
      queryParams
    )
    
    // UPSERT schema_deployment for the entity
    await upsertSchemaDeployment(entityId)
    
    return NextResponse.json({
      attribute_id: attributeId,
      entity_id: entityId,
      updated_at: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to update attribute')
    return NextResponse.json(
      { error: 'Failed to update attribute' },
      { status: 500 }
    )
  }
}

// DELETE /api/attributes/[attributeId] - Delete attribute
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'DELETE /api/attributes/[attributeId]')
  
  try {
    // Get entity_id before delete for schema_deployment
    const attrResult = await dbQuery<{ entity_id: number }>(
      'SELECT entity_id FROM mds_meta.attribute WHERE id = @id',
      { id: parseInt(attributeId) }
    )
    
    if (attrResult.length === 0) {
      return NextResponse.json(
        { error: 'Attribute not found' },
        { status: 404 }
      )
    }
    
    const entityId = attrResult[0].entity_id
    
    await dbExecute(
      'DELETE FROM mds_meta.attribute WHERE id = @id',
      { id: parseInt(attributeId) }
    )
    
    // UPSERT schema_deployment for the entity
    await upsertSchemaDeployment(entityId)
    
    return NextResponse.json({ success: true, entity_id: entityId })
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to delete attribute')
    return NextResponse.json(
      { error: 'Failed to delete attribute' },
      { status: 500 }
    )
  }
}
