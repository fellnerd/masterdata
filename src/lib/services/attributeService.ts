import { dbQuery, dbExecute } from '@/lib/db-server'
import type { ServiceResult } from './types'
import { upsertSchemaDeployment } from './schemaDeployment'

export interface Attribute {
  id: number
  entity_id: number
  entity_code?: string
  entity_name?: string
  model_id?: number
  model_code?: string
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
  reference_entity_code?: string | null
  validation_regex: string | null
  sort_order: number
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

export async function listAttributes(entityId?: number): Promise<ServiceResult<Attribute[]>> {
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
    params.entityId = entityId
  }
  sql += ` ORDER BY e.name, a.sort_order, a.name`

  const results = await dbQuery<Attribute>(sql, params)
  return { ok: true, data: results }
}

export async function getAttribute(id: number): Promise<ServiceResult<Attribute>> {
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
    { id }
  )
  if (results.length === 0) {
    return { ok: false, status: 404, error: 'Attribute not found' }
  }
  return { ok: true, data: results[0] }
}

export interface CreateAttributeInput {
  entity_id: number
  code: string
  name: string
  description?: string | null
  data_type?: string
  sql_type?: string | null
  max_length?: number | null
  precision?: number | null
  scale?: number | null
  is_required?: boolean
  is_business_key?: boolean
  is_unique?: boolean
  default_value?: string | null
  reference_entity_id?: number | null
  validation_regex?: string | null
  sort_order?: number
  created_by?: string
}

export async function createAttribute(input: CreateAttributeInput): Promise<ServiceResult<Attribute>> {
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
    sort_order = 0,
    created_by = 'admin'
  } = input

  if (!entity_id || !code || !name) {
    return { ok: false, status: 400, error: 'entity_id, code and name are required' }
  }

  const entity = await dbQuery<{ id: number }>(
    'SELECT id FROM [mds_meta].[entity] WHERE id = @entityId',
    { entityId: entity_id }
  )
  if (entity.length === 0) {
    return { ok: false, status: 404, error: 'Entity not found' }
  }

  const existing = await dbQuery<{ id: number }>(
    'SELECT id FROM [mds_meta].[attribute] WHERE entity_id = @entityId AND code = @code',
    { entityId: entity_id, code }
  )
  if (existing.length > 0) {
    return { ok: false, status: 409, error: 'Attribute with this code already exists in this entity' }
  }

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
      user: created_by
    }
  )

  const created = await dbQuery<Attribute>(
    `SELECT a.*, e.code AS entity_code, e.name AS entity_name
     FROM [mds_meta].[attribute] a
     INNER JOIN [mds_meta].[entity] e ON e.id = a.entity_id
     WHERE a.entity_id = @entityId AND a.code = @code`,
    { entityId: entity_id, code }
  )

  await upsertSchemaDeployment(entity_id)

  return { ok: true, data: created[0] }
}

export interface UpdateAttributeInput {
  name?: string
  description?: string | null
  data_type?: string
  sql_type?: string | null
  max_length?: number | null
  precision?: number | null
  scale?: number | null
  is_required?: boolean
  is_business_key?: boolean
  is_unique?: boolean
  default_value?: string | null
  reference_entity_id?: number | null
  validation_regex?: string | null
  sort_order?: number
  updated_by?: string
}

// Preserves the internal route's exact prior response shape. Callers that
// need the full updated resource (v1 PUT) should follow up with getAttribute(id).
export async function updateAttribute(
  id: number,
  input: UpdateAttributeInput
): Promise<ServiceResult<{ attribute_id: number; entity_id: number; updated_at: string }>> {
  const {
    name, description, data_type, sql_type, max_length, precision, scale,
    is_required, is_business_key, is_unique, default_value, reference_entity_id,
    validation_regex, sort_order, updated_by = 'admin'
  } = input

  const updates: string[] = []
  const queryParams: Record<string, unknown> = { id }

  if (name !== undefined) { updates.push('name = @name'); queryParams.name = name }
  if (description !== undefined) { updates.push('description = @description'); queryParams.description = description }
  if (data_type !== undefined) { updates.push('data_type = @data_type'); queryParams.data_type = data_type }
  if (sql_type !== undefined) { updates.push('sql_type = @sql_type'); queryParams.sql_type = sql_type }
  if (max_length !== undefined) { updates.push('max_length = @max_length'); queryParams.max_length = max_length }
  if (precision !== undefined) { updates.push('[precision] = @precision'); queryParams.precision = precision }
  if (scale !== undefined) { updates.push('scale = @scale'); queryParams.scale = scale }
  if (is_required !== undefined) { updates.push('is_required = @is_required'); queryParams.is_required = is_required }
  if (is_business_key !== undefined) { updates.push('is_business_key = @is_business_key'); queryParams.is_business_key = is_business_key }
  if (is_unique !== undefined) { updates.push('is_unique = @is_unique'); queryParams.is_unique = is_unique }
  if (default_value !== undefined) { updates.push('default_value = @default_value'); queryParams.default_value = default_value }
  if (reference_entity_id !== undefined) { updates.push('reference_entity_id = @reference_entity_id'); queryParams.reference_entity_id = reference_entity_id }
  if (validation_regex !== undefined) { updates.push('validation_regex = @validation_regex'); queryParams.validation_regex = validation_regex }
  if (sort_order !== undefined) { updates.push('sort_order = @sort_order'); queryParams.sort_order = sort_order }

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No fields to update' }
  }

  updates.push('updated_at = GETUTCDATE()')
  updates.push('updated_by = @updated_by')
  queryParams.updated_by = updated_by

  const attrResult = await dbQuery<{ entity_id: number }>(
    'SELECT entity_id FROM mds_meta.attribute WHERE id = @id',
    { id }
  )
  if (attrResult.length === 0) {
    return { ok: false, status: 404, error: 'Attribute not found' }
  }
  const entityId = attrResult[0].entity_id

  await dbExecute(`UPDATE mds_meta.attribute SET ${updates.join(', ')} WHERE id = @id`, queryParams)
  await upsertSchemaDeployment(entityId)

  return { ok: true, data: { attribute_id: id, entity_id: entityId, updated_at: new Date().toISOString() } }
}

export async function deleteAttribute(id: number): Promise<ServiceResult<{ success: true; entity_id: number }>> {
  const attrResult = await dbQuery<{ entity_id: number }>(
    'SELECT entity_id FROM mds_meta.attribute WHERE id = @id',
    { id }
  )
  if (attrResult.length === 0) {
    return { ok: false, status: 404, error: 'Attribute not found' }
  }
  const entityId = attrResult[0].entity_id

  await dbExecute('DELETE FROM mds_meta.attribute WHERE id = @id', { id })
  await upsertSchemaDeployment(entityId)

  return { ok: true, data: { success: true, entity_id: entityId } }
}
