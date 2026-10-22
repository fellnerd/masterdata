import { dbQuery, dbExecute } from '@/lib/db-server'
import type { ServiceResult } from './types'
import { upsertSchemaDeployment } from './schemaDeployment'
import { redeployViewsForEntity } from './viewDeployService'
import { validateReferenceConfig, normalizeReferenceConfig } from '@/lib/referenceConfig'

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
  /** Attribute (code) of the referenced entity shown in the dropdown; null = its business key (always what is stored). */
  reference_display_attribute: string | null
  /** Attribute (code) of THIS entity whose value narrows the dropdown (cascade); null = no cascade. */
  cascade_parent_attribute: string | null
  /** Attribute (code) of the REFERENCED entity compared with the parent's value. */
  cascade_filter_attribute: string | null
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
      a.reference_display_attribute,
      a.cascade_parent_attribute,
      a.cascade_filter_attribute,
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
  sql += ` ORDER BY e.name, a.sort_order, a.id`

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
  reference_display_attribute?: string | null
  cascade_parent_attribute?: string | null
  cascade_filter_attribute?: string | null
  validation_regex?: string | null
  /** Position in forms/exports; omitted = appended after the entity's last attribute. */
  sort_order?: number
  created_by?: string
}

// Columns every load/master table has of its own. An attribute with one of these codes would
// produce a table/view with that column twice (SQL error "Column names ... must be unique" at
// Deploy Schema), so such codes are refused up front.
export const RESERVED_ATTRIBUTE_CODES = [
  'business_key', 'business_key_hash', 'valid_from', 'valid_to', 'is_current', 'is_deleted',
  'commit_id', 'operation', 'source_system', 'source_id', 'source_load_id', 'is_processed',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'processed_at', 'load_id', 'load_timestamp',
]

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
    reference_display_attribute,
    cascade_parent_attribute,
    cascade_filter_attribute,
    validation_regex,
    sort_order,
    created_by = 'admin'
  } = input

  if (!entity_id || !code || !name) {
    return { ok: false, status: 400, error: 'entity_id, code and name are required' }
  }
  if (RESERVED_ATTRIBUTE_CODES.includes(String(code).toLowerCase())) {
    return {
      ok: false,
      status: 400,
      error: `"${code}" is a reserved column name (every table has its own ${RESERVED_ATTRIBUTE_CODES.slice(0, 6).join(', ')}, ...). ` +
        `Pick another code, e.g. "${code}_date" or a more specific name.`
    }
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

  const refCfg = normalizeReferenceConfig({
    data_type,
    reference_entity_id: reference_entity_id ?? null,
    reference_display_attribute: reference_display_attribute ?? null,
    cascade_parent_attribute: cascade_parent_attribute ?? null,
    cascade_filter_attribute: cascade_filter_attribute ?? null,
  })
  const refError = await validateReferenceConfig(entity_id, code, refCfg)
  if (refError) {
    return { ok: false, status: 400, error: refError }
  }

  // Without an explicit position the attribute goes last. (It used to default
  // to 0, so every new attribute tied with all the others and the form order
  // fell back to alphabetical.)
  let position = sort_order
  if (position === undefined || position === null) {
    const max = await dbQuery<{ max_order: number | null }>(
      'SELECT MAX(sort_order) AS max_order FROM [mds_meta].[attribute] WHERE entity_id = @entityId',
      { entityId: entity_id }
    )
    position = (max[0]?.max_order ?? 0) + 10
  }

  await dbExecute(
    `INSERT INTO [mds_meta].[attribute]
      (entity_id, code, name, description, data_type, sql_type, max_length, [precision], scale,
       is_required, is_business_key, is_unique, default_value, reference_entity_id,
       reference_display_attribute, cascade_parent_attribute, cascade_filter_attribute,
       validation_regex, sort_order, created_by, updated_by)
     VALUES (@entityId, @code, @name, @description, @dataType, @sqlType, @maxLength, @precision, @scale,
             @isRequired, @isBusinessKey, @isUnique, @defaultValue, @referenceEntityId,
             @refDisplayAttr, @cascadeParent, @cascadeFilter,
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
      refDisplayAttr: refCfg.reference_display_attribute,
      cascadeParent: refCfg.cascade_parent_attribute,
      cascadeFilter: refCfg.cascade_filter_attribute,
      validationRegex: validation_regex || null,
      sortOrder: position,
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
  reference_display_attribute?: string | null
  cascade_parent_attribute?: string | null
  cascade_filter_attribute?: string | null
  validation_regex?: string | null
  sort_order?: number
  updated_by?: string
  /** Immutable - accepted only so a request that sends the unchanged code back
   *  isn't rejected; a different value is a 400 (see updateAttribute). */
  code?: string
}

// Preserves the internal route's exact prior response shape. Callers that
// need the full updated resource (v1 PUT) should follow up with getAttribute(id).
export async function updateAttribute(
  id: number,
  input: UpdateAttributeInput
): Promise<ServiceResult<{ attribute_id: number; entity_id: number; updated_at: string; views_redeployed?: string[]; warnings?: string[] }>> {
  const {
    code, name, description, data_type, sql_type, max_length, precision, scale,
    is_required, is_business_key, is_unique, default_value, reference_entity_id,
    reference_display_attribute, cascade_parent_attribute, cascade_filter_attribute,
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
  if (reference_display_attribute !== undefined) { updates.push('reference_display_attribute = @reference_display_attribute'); queryParams.reference_display_attribute = reference_display_attribute || null }
  if (cascade_parent_attribute !== undefined) { updates.push('cascade_parent_attribute = @cascade_parent_attribute'); queryParams.cascade_parent_attribute = cascade_parent_attribute || null }
  if (cascade_filter_attribute !== undefined) { updates.push('cascade_filter_attribute = @cascade_filter_attribute'); queryParams.cascade_filter_attribute = cascade_filter_attribute || null }
  if (validation_regex !== undefined) { updates.push('validation_regex = @validation_regex'); queryParams.validation_regex = validation_regex }
  if (sort_order !== undefined) { updates.push('sort_order = @sort_order'); queryParams.sort_order = sort_order }

  const attrResult = await dbQuery<{
    entity_id: number; code: string; data_type: string; precision: number | null; scale: number | null
    reference_entity_id: number | null; reference_display_attribute: string | null
    cascade_parent_attribute: string | null; cascade_filter_attribute: string | null
  }>(
    `SELECT entity_id, code, data_type, [precision], scale, reference_entity_id,
            reference_display_attribute, cascade_parent_attribute, cascade_filter_attribute
     FROM mds_meta.attribute WHERE id = @id`,
    { id }
  )
  if (attrResult.length === 0) {
    return { ok: false, status: 404, error: 'Attribute not found' }
  }
  const entityId = attrResult[0].entity_id
  const current = attrResult[0]

  // The code is the key everywhere downstream - the JSON key in every staged
  // payload, the mds_load/mds_master column, and the deployed view column -
  // so changing it in mds_meta alone would silently orphan all of them. It
  // used to be dropped without a word (200, code unchanged); refuse instead.
  if (code !== undefined && code !== current.code) {
    return {
      ok: false,
      status: 400,
      error: `Attribute code is immutable ('${current.code}' cannot be renamed to '${code}'). ` +
        'To change it, create a new attribute and delete this one - existing values are not carried over.'
    }
  }

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No fields to update' }
  }

  // Validate the reference/cascade setup as it will be AFTER this update
  // (merge the incoming fields over the stored ones).
  const touchesReferenceConfig =
    reference_display_attribute !== undefined ||
    cascade_parent_attribute !== undefined || cascade_filter_attribute !== undefined ||
    data_type !== undefined || reference_entity_id !== undefined
  if (touchesReferenceConfig) {
    const refError = await validateReferenceConfig(entityId, current.code, {
      data_type: data_type ?? current.data_type,
      reference_entity_id: reference_entity_id !== undefined ? reference_entity_id : current.reference_entity_id,
      reference_display_attribute: reference_display_attribute !== undefined ? reference_display_attribute : current.reference_display_attribute,
      cascade_parent_attribute: cascade_parent_attribute !== undefined ? cascade_parent_attribute : current.cascade_parent_attribute,
      cascade_filter_attribute: cascade_filter_attribute !== undefined ? cascade_filter_attribute : current.cascade_filter_attribute,
    })
    if (refError) {
      return { ok: false, status: 400, error: refError }
    }
  }

  updates.push('updated_at = GETUTCDATE()')
  updates.push('updated_by = @updated_by')
  queryParams.updated_by = updated_by

  await dbExecute(`UPDATE mds_meta.attribute SET ${updates.join(', ')} WHERE id = @id`, queryParams)
  await upsertSchemaDeployment(entityId)

  // Deployed views expose typed columns derived from data_type/precision/scale
  // (see viewDeployService.typedColumnExpr), so a change there needs the views
  // regenerated to take effect.
  const typingChanged =
    (data_type !== undefined && data_type !== current.data_type) ||
    (precision !== undefined && precision !== current.precision) ||
    (scale !== undefined && scale !== current.scale)

  const data: { attribute_id: number; entity_id: number; updated_at: string; views_redeployed?: string[]; warnings?: string[] } =
    { attribute_id: id, entity_id: entityId, updated_at: new Date().toISOString() }

  if (typingChanged) {
    Object.assign(data, await redeployViewsSafely(entityId, updated_by))
  }

  return { ok: true, data }
}

// Best-effort: a failed redeploy must not fail the attribute change itself
// (it's already saved) - report it in `warnings` so the caller can see the
// view needs attention instead of finding out from a 500 later.
async function redeployViewsSafely(
  entityId: number,
  user: string
): Promise<{ views_redeployed?: string[]; warnings?: string[] }> {
  try {
    const results = await redeployViewsForEntity(entityId, user)
    if (results.length === 0) return {}
    const ok = results.filter(r => r.status === 'success').map(r => r.code)
    const failed = results.filter(r => r.status === 'failed')
    return {
      views_redeployed: ok,
      ...(failed.length > 0 && {
        warnings: failed.map(r => `View ${r.code} could not be redeployed and may be out of date: ${r.error}`)
      })
    }
  } catch (error) {
    return { warnings: [`Deployed views could not be redeployed and may be out of date: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

export async function deleteAttribute(
  id: number
): Promise<ServiceResult<{ success: true; entity_id: number; views_redeployed?: string[]; warnings?: string[] }>> {
  const attrResult = await dbQuery<{ entity_id: number; code: string }>(
    'SELECT entity_id, code FROM mds_meta.attribute WHERE id = @id',
    { id }
  )
  if (attrResult.length === 0) {
    return { ok: false, status: 404, error: 'Attribute not found' }
  }
  const entityId = attrResult[0].entity_id
  const attrCode = attrResult[0].code

  await dbExecute('DELETE FROM mds_meta.attribute WHERE id = @id', { id })

  // Display / cascade settings that pointed at the deleted attribute just stop
  // applying: the dropdown falls back to the stored value, the cascade is off.
  await dbExecute(
    `UPDATE mds_meta.attribute SET reference_display_attribute = NULL
     WHERE reference_entity_id = @entityId AND reference_display_attribute = @attrCode`,
    { entityId, attrCode }
  )
  await dbExecute(
    `UPDATE mds_meta.attribute SET cascade_parent_attribute = NULL, cascade_filter_attribute = NULL
     WHERE (entity_id = @entityId AND cascade_parent_attribute = @attrCode)
        OR (reference_entity_id = @entityId AND cascade_filter_attribute = @attrCode)`,
    { entityId, attrCode }
  )
  await upsertSchemaDeployment(entityId)

  // A deployed view selects this attribute's column by name; once the
  // attribute is gone, GET /views/... fails with "Invalid column name" until
  // someone happens to redeploy. Regenerate the entity's deployed views right
  // away (the master column itself stays - only the view stops selecting it).
  const redeploy = await redeployViewsSafely(entityId, 'system:attribute-delete')

  return { ok: true, data: { success: true, entity_id: entityId, ...redeploy } }
}

// Sets the order of an entity's attributes (form field order, column order of
// the next generated models/views). `orderedIds` must contain every attribute
// id of the entity exactly once; positions become 10, 20, 30, ... so a later
// single insert/move still has room and ties (the old default: everything 0)
// are gone.
//
// One thing is deliberately NOT free: a composite business key is built by
// joining the business-key attributes' values in this order (see
// getBusinessKeyAttributeCodes / import_from_datavault.sql). Reordering them
// relative to each other would make newly derived keys differ from the keys
// already stored, so that is refused once the entity has any staged record.
// Moving non-key attributes around - or around the key attributes - is fine.
export async function reorderAttributes(
  entityId: number,
  orderedIds: number[],
  updatedBy = 'admin'
): Promise<ServiceResult<{ entity_id: number; attributes: Pick<Attribute, 'id' | 'code' | 'sort_order'>[] }>> {
  const current = await dbQuery<{ id: number; code: string; is_business_key: boolean }>(
    'SELECT id, code, is_business_key FROM mds_meta.attribute WHERE entity_id = @entityId ORDER BY sort_order, id',
    { entityId }
  )
  if (current.length === 0) {
    return { ok: false, status: 404, error: 'Entity not found or it has no attributes' }
  }

  if (!Array.isArray(orderedIds) || orderedIds.some(id => !Number.isInteger(id))) {
    return { ok: false, status: 400, error: 'order must be an array of attribute ids' }
  }
  const have = new Set(current.map(a => a.id))
  const given = new Set(orderedIds)
  const unknown = orderedIds.filter(id => !have.has(id))
  const missing = current.filter(a => !given.has(a.id)).map(a => a.id)
  if (given.size !== orderedIds.length || unknown.length > 0 || missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: 'order must list every attribute of the entity exactly once' +
        (unknown.length ? ` (not in this entity: ${unknown.join(', ')})` : '') +
        (missing.length ? ` (missing: ${missing.join(', ')})` : '') +
        (given.size !== orderedIds.length ? ' (duplicates)' : '')
    }
  }

  const byId = new Map(current.map(a => [a.id, a]))
  const bkBefore = current.filter(a => a.is_business_key).map(a => a.id)
  const bkAfter = orderedIds.filter(id => byId.get(id)!.is_business_key)
  if (bkBefore.join(',') !== bkAfter.join(',')) {
    const staged = await dbQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM mds_stage.staged_record WHERE entity_id = @entityId',
      { entityId }
    )
    if ((staged[0]?.n ?? 0) > 0) {
      return {
        ok: false,
        status: 409,
        error: 'The relative order of the business-key attributes cannot change while the entity has records: ' +
          'composite business keys are built in this order, so new keys would no longer match the stored ones. ' +
          'Move the other attributes instead (keep the business-key attributes in their current order).'
      }
    }
  }

  const caseSql = orderedIds.map((_, i) => `WHEN @id${i} THEN ${(i + 1) * 10}`).join(' ')
  const params: Record<string, unknown> = { entityId, updatedBy }
  orderedIds.forEach((id, i) => { params[`id${i}`] = id })
  await dbExecute(
    `UPDATE mds_meta.attribute
     SET sort_order = CASE id ${caseSql} END, updated_at = GETUTCDATE(), updated_by = @updatedBy
     WHERE entity_id = @entityId`,
    params
  )

  return {
    ok: true,
    data: {
      entity_id: entityId,
      attributes: orderedIds.map((id, i) => ({ id, code: byId.get(id)!.code, sort_order: (i + 1) * 10 })),
    },
  }
}
