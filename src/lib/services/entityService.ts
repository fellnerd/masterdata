import { dbQuery, dbExecute } from '@/lib/db-server'
import type { ServiceResult } from './types'
import { upsertSchemaDeployment } from './schemaDeployment'

export interface Entity {
  id: number
  model_id: number
  model_code?: string
  model_name?: string
  code: string
  name: string
  description: string | null
  source_table: string | null
  staging_view: string | null
  hub_name: string | null
  is_deployed: boolean
  last_deployed_at: string | null
  record_count: number | null
  status: 'draft' | 'active' | 'deprecated'
  scd_type: 'SCD1' | 'SCD2'
  primary_key_attribute: string | null
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
  // Computed fields
  attribute_count?: number
}

interface AttributeSummary {
  id: number
  code: string
  name: string
  data_type: string
  is_required: boolean
  is_business_key: boolean
  sort_order: number
}

export async function listEntities(modelId?: number): Promise<ServiceResult<Entity[]>> {
  let sql = `
    SELECT
      e.id,
      e.model_id,
      m.code AS model_code,
      m.name AS model_name,
      e.code,
      e.name,
      e.description,
      e.source_table,
      e.staging_view,
      e.hub_name,
      e.is_deployed,
      e.last_deployed_at,
      e.record_count,
      e.status,
      e.scd_type,
      e.primary_key_attribute,
      e.import_source_object,
      e.import_column_mapping,
      e.import_filter,
      e.import_schedule,
      e.import_tracking_column,
      e.last_import_at,
      e.created_at,
      e.created_by,
      e.updated_at,
      e.updated_by,
      (SELECT COUNT(*) FROM [mds_meta].[attribute] a WHERE a.entity_id = e.id) AS attribute_count
    FROM [mds_meta].[entity] e
    INNER JOIN [mds_meta].[model] m ON m.id = e.model_id
  `

  const params: Record<string, unknown> = {}
  if (modelId) {
    sql += ` WHERE e.model_id = @modelId`
    params.modelId = modelId
  }
  sql += ` ORDER BY m.name, e.name`

  const results = await dbQuery<Entity>(sql, params)
  return { ok: true, data: results }
}

// Matches the internal single-GET's existing shape exactly: bare entity
// columns (no model join) plus its attributes.
export async function getEntity(id: number): Promise<ServiceResult<Entity & { attributes: AttributeSummary[] }>> {
  const entities = await dbQuery<Entity>('SELECT * FROM mds_meta.entity WHERE id = @id', { id })
  if (entities.length === 0) {
    return { ok: false, status: 404, error: 'Entity not found' }
  }

  const attributes = await dbQuery<AttributeSummary>(
    `SELECT id, code, name, data_type, is_required, is_business_key, sort_order
     FROM mds_meta.attribute
     WHERE entity_id = @entityId
     ORDER BY sort_order`,
    { entityId: id }
  )

  return { ok: true, data: { ...entities[0], attributes } }
}

// Resolves a v1 path segment that may be either a numeric entity id or an
// entity code. entity.code is only UNIQUE(model_id, code), not globally
// unique, so a bare code lookup can be ambiguous across models - callers
// should pass modelCode when they have it (e.g. from a ?model_code= query
// param) to disambiguate; otherwise an ambiguous code returns 409.
export async function resolveEntityId(idOrCode: string, modelCode?: string): Promise<ServiceResult<number>> {
  if (/^\d+$/.test(idOrCode)) {
    const id = parseInt(idOrCode)
    const rows = await dbQuery<{ id: number }>('SELECT id FROM mds_meta.entity WHERE id = @id', { id })
    if (rows.length === 0) {
      return { ok: false, status: 404, error: 'Entity not found' }
    }
    return { ok: true, data: id }
  }

  let sql = `SELECT e.id FROM mds_meta.entity e JOIN mds_meta.model m ON m.id = e.model_id WHERE e.code = @code`
  const params: Record<string, unknown> = { code: idOrCode }
  if (modelCode) {
    sql += ' AND m.code = @modelCode'
    params.modelCode = modelCode
  }

  const rows = await dbQuery<{ id: number }>(sql, params)
  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Entity not found' }
  }
  if (rows.length > 1) {
    return {
      ok: false,
      status: 409,
      error: `Multiple entities found with code '${idOrCode}' across different models. Add ?model_code= to disambiguate.`
    }
  }
  return { ok: true, data: rows[0].id }
}

export interface CreateEntityInput {
  model_id: number
  code: string
  name: string
  description?: string | null
  source_table?: string | null
  staging_view?: string | null
  hub_name?: string | null
  scd_type?: string
  created_by?: string
}

export async function createEntity(input: CreateEntityInput): Promise<ServiceResult<Entity>> {
  const { model_id, code, name, description, source_table, staging_view, hub_name, scd_type, created_by = 'admin' } = input

  if (!model_id || !code || !name) {
    return { ok: false, status: 400, error: 'model_id, code and name are required' }
  }

  const model = await dbQuery<{ id: number }>(
    'SELECT id FROM [mds_meta].[model] WHERE id = @modelId',
    { modelId: model_id }
  )
  if (model.length === 0) {
    return { ok: false, status: 404, error: 'Model not found' }
  }

  const existing = await dbQuery<{ id: number }>(
    'SELECT id FROM [mds_meta].[entity] WHERE model_id = @modelId AND code = @code',
    { modelId: model_id, code }
  )
  if (existing.length > 0) {
    return { ok: false, status: 409, error: 'Entity with this code already exists in this model' }
  }

  const target_table = code.toLowerCase()
  const business_key_columns = 'id'

  await dbExecute(
    `INSERT INTO [mds_meta].[entity]
      (model_id, code, name, description, source_table, staging_view, hub_name, target_table, business_key_columns, scd_type, created_by, updated_by)
     VALUES (@modelId, @code, @name, @description, @source_table, @staging_view, @hub_name, @target_table, @business_key_columns, @scd_type, @user, @user)`,
    {
      modelId: model_id,
      code,
      name,
      description: description || null,
      source_table: source_table || null,
      staging_view: staging_view || null,
      hub_name: hub_name || null,
      target_table,
      business_key_columns,
      scd_type: scd_type || 'SCD2',
      user: created_by
    }
  )

  const created = await dbQuery<Entity>(
    `SELECT e.*, m.code AS model_code, m.name AS model_name
     FROM [mds_meta].[entity] e
     INNER JOIN [mds_meta].[model] m ON m.id = e.model_id
     WHERE e.model_id = @modelId AND e.code = @code`,
    { modelId: model_id, code }
  )

  await upsertSchemaDeployment(created[0].id)

  return { ok: true, data: created[0] }
}

export interface UpdateEntityInput {
  name?: string
  description?: string | null
  scd_type?: string
  status?: string
  updated_by?: string
}

// Preserves the internal route's exact prior response shape. Callers that
// need the full updated resource (v1 PUT) should follow up with getEntity(id).
export async function updateEntity(id: number, input: UpdateEntityInput): Promise<ServiceResult<{ entity_id: number; updated_at: string }>> {
  const { name, description, scd_type, status, updated_by = 'admin' } = input

  const updates: string[] = []
  const queryParams: Record<string, unknown> = { id }

  if (name !== undefined) { updates.push('name = @name'); queryParams.name = name }
  if (description !== undefined) { updates.push('description = @description'); queryParams.description = description }
  if (scd_type !== undefined) { updates.push('scd_type = @scd_type'); queryParams.scd_type = scd_type }
  if (status !== undefined) { updates.push('status = @status'); queryParams.status = status }

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No fields to update' }
  }

  updates.push('updated_at = GETUTCDATE()')
  updates.push('updated_by = @updated_by')
  queryParams.updated_by = updated_by

  await dbExecute(`UPDATE mds_meta.entity SET ${updates.join(', ')} WHERE id = @id`, queryParams)
  await upsertSchemaDeployment(id)

  return { ok: true, data: { entity_id: id, updated_at: new Date().toISOString() } }
}

// DELETE - only genuinely *outstanding* work blocks deletion: uncommitted
// staged records, and commits still in flight (draft/pending/approved - not
// yet deployed or rejected). Everything else is history - already-deployed
// staged records, terminal (deployed/rejected) commits, and deployment_log
// entries - is cleaned up automatically as part of the delete, since it has
// no further use once the entity itself is gone. schema_deployment has
// ON DELETE CASCADE in the schema, so it needs no explicit cleanup here.
//
// Note: this does NOT drop the physical dbt-generated mds_master/mds_load
// tables for the entity (e.g. mds_master.<target_table>) - those are
// managed by dbt runs, not by this API, and may still hold historized data.
// Deleting the entity here only removes it from MDS metadata/staging.
export async function deleteEntity(id: number): Promise<ServiceResult<{ success: true }>> {
  const attributes = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM mds_meta.attribute WHERE entity_id = @id',
    { id }
  )
  if (attributes[0].count > 0) {
    return { ok: false, status: 400, error: 'Cannot delete entity with existing attributes. Delete attributes first.' }
  }

  const pendingRecords = await dbQuery<{ count: number }>(
    "SELECT COUNT(*) as count FROM mds_stage.staged_record WHERE entity_id = @id AND UPPER(status) = 'PENDING'",
    { id }
  )
  if (pendingRecords[0].count > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot delete entity: ${pendingRecords[0].count} uncommitted staged record(s). Commit or discard them first.`
    }
  }

  const [outstandingCommits, views, referencedBy] = await Promise.all([
    dbQuery<{ count: number }>(
      "SELECT COUNT(*) as count FROM mds_stage.[commit] WHERE entity_id = @id AND status NOT IN ('deployed', 'rejected')",
      { id }
    ),
    dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM mds_meta.entity_view WHERE entity_id = @id', { id }),
    dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM mds_meta.attribute WHERE reference_entity_id = @id', { id }),
  ])

  if (outstandingCommits[0].count > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot delete entity: ${outstandingCommits[0].count} commit(s) still awaiting review or deployment.`
    }
  }
  if (views[0].count > 0) {
    return { ok: false, status: 400, error: `Cannot delete entity with ${views[0].count} view(s) defined on it. Delete the view(s) first.` }
  }
  if (referencedBy[0].count > 0) {
    return { ok: false, status: 400, error: `Cannot delete entity: ${referencedBy[0].count} attribute(s) on other entities reference it.` }
  }

  try {
    // Everything left is terminal history - clean it up, then delete the entity.
    await dbExecute('DELETE FROM mds_stage.staged_record WHERE entity_id = @id', { id })
    await dbExecute('DELETE FROM mds_load.deployment_log WHERE entity_id = @id', { id })
    await dbExecute("DELETE FROM mds_stage.[commit] WHERE entity_id = @id", { id })
    await dbExecute('DELETE FROM mds_meta.entity WHERE id = @id', { id })
  } catch (error) {
    // Safety net for any FK constraint not covered by the checks above
    // (e.g. a future table added with a reference to entity.id).
    const isFkViolation = error instanceof Error && 'number' in error && (error as { number?: number }).number === 547
    if (isFkViolation) {
      return { ok: false, status: 400, error: 'Cannot delete entity: other records still reference it.' }
    }
    throw error
  }

  return { ok: true, data: { success: true } }
}
