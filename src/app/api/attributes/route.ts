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

export interface Attribute {
  id: number
  entity_id: number
  entity_code?: string
  entity_name?: string
  model_code?: string
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
  reference_entity_code?: string | null
  validation_regex: string | null
  sort_order: number
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

// GET /api/attributes - List all attributes
export async function GET(request: NextRequest) {
  logger.info('GET /api/attributes')
  
  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    
    let sql = `
      SELECT 
        a.id,
        a.entity_id,
        e.code AS entity_code,
        e.name AS entity_name,
        m.code AS model_code,
        a.code,
        a.name,
        a.description,
        a.data_type,
        a.sql_type,
        a.max_length,
        a.[precision],
        a.scale,
        a.is_required,
        a.is_business_key,
        a.is_unique,
        a.default_value,
        a.reference_entity_id,
        ref.code AS reference_entity_code,
        a.validation_regex,
        a.sort_order,
        a.created_at,
        a.created_by,
        a.updated_at,
        a.updated_by
      FROM [mds_meta].[attribute] a
      INNER JOIN [mds_meta].[entity] e ON e.id = a.entity_id
      INNER JOIN [mds_meta].[model] m ON m.id = e.model_id
      LEFT JOIN [mds_meta].[entity] ref ON ref.id = a.reference_entity_id
    `
    
    const params: Record<string, unknown> = {}
    
    if (entityId) {
      sql += ` WHERE a.entity_id = @entityId`
      params.entityId = parseInt(entityId)
    }
    
    sql += ` ORDER BY e.name, a.sort_order, a.name`
    
    const results = await dbQuery<Attribute>(sql, params)
    
    // Compute summary stats
    const businessKeys = results.filter(a => a.is_business_key).length
    const references = results.filter(a => a.reference_entity_id !== null).length
    const entityCount = new Set(results.map(a => a.entity_id)).size
    
    return NextResponse.json({
      data: results,
      total: results.length,
      summary: {
        total: results.length,
        businessKeys,
        references,
        entities: entityCount
      }
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch attributes')
    return NextResponse.json(
      { error: 'Failed to fetch attributes', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/attributes - Create new attribute
export async function POST(request: NextRequest) {
  logger.info('POST /api/attributes')
  
  try {
    const body = await request.json()
    const { 
      entity_id, 
      code, 
      name, 
      description,
      data_type = 'nvarchar',
      sql_type,
      max_length,
      precision,
      scale,
      is_required = false,
      is_business_key = false,
      is_unique = false,
      default_value,
      reference_entity_id,
      validation_regex,
      sort_order = 0
    } = body
    
    if (!entity_id || !code || !name) {
      return NextResponse.json(
        { error: 'entity_id, code and name are required' },
        { status: 400 }
      )
    }
    
    // Check if entity exists
    const entity = await dbQuery<{ id: number }>(
      'SELECT id FROM [mds_meta].[entity] WHERE id = @entityId',
      { entityId: entity_id }
    )
    if (entity.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }
    
    // Check for duplicate code in entity
    const existing = await dbQuery<{ id: number }>(
      'SELECT id FROM [mds_meta].[attribute] WHERE entity_id = @entityId AND code = @code',
      { entityId: entity_id, code }
    )
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Attribute with this code already exists in this entity' },
        { status: 409 }
      )
    }
    
    const currentUser = 'admin'
    
    await dbExecute(
      `INSERT INTO [mds_meta].[attribute] 
        (entity_id, code, name, description, data_type, sql_type, max_length, [precision], scale, 
         is_required, is_business_key, is_unique, default_value, reference_entity_id, 
         validation_regex, sort_order, created_by, updated_by)
       VALUES (@entityId, @code, @name, @description, @dataType, @sqlType, @maxLength, @precision, @scale,
               @isRequired, @isBusinessKey, @isUnique, @defaultValue, @referenceEntityId,
               @validationRegex, @sortOrder, @user, @user)`,
      { 
        entityId: entity_id,
        code, 
        name, 
        description: description || null,
        dataType: data_type,
        sqlType: sql_type || null,
        maxLength: max_length || null,
        precision: precision || null,
        scale: scale || null,
        isRequired: is_required,
        isBusinessKey: is_business_key,
        isUnique: is_unique,
        defaultValue: default_value || null,
        referenceEntityId: reference_entity_id || null,
        validationRegex: validation_regex || null,
        sortOrder: sort_order,
        user: currentUser 
      }
    )
    
    // Fetch the created attribute
    const created = await dbQuery<Attribute>(
      `SELECT a.*, e.code AS entity_code, e.name AS entity_name
       FROM [mds_meta].[attribute] a
       INNER JOIN [mds_meta].[entity] e ON e.id = a.entity_id
       WHERE a.entity_id = @entityId AND a.code = @code`,
      { entityId: entity_id, code }
    )
    
    // UPSERT schema_deployment for the entity
    await upsertSchemaDeployment(entity_id)
    
    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create attribute')
    return NextResponse.json(
      { error: 'Failed to create attribute', details: String(error) },
      { status: 500 }
    )
  }
}
