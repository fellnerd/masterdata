import { dbQuery, dbExecute } from '@/lib/db-server'
import type { ServiceResult } from './types'
import { backfillSchemaDeploymentForModel } from './schemaDeployment'

export interface Model {
  id: number
  code: string
  name: string
  description: string | null
  version: number
  status: 'draft' | 'active' | 'deprecated'
  source_database: string | null
  target_schema: string | null
  created_at: string
  created_by: string
  updated_at: string | null
  updated_by: string | null
  // Computed fields
  entity_count?: number
  record_count?: number
}

export async function listModels(): Promise<ServiceResult<Model[]>> {
  const results = await dbQuery<Model>(`
    SELECT
      m.id,
      m.code,
      m.name,
      m.description,
      m.version,
      m.status,
      m.source_database,
      m.target_schema,
      m.created_at,
      m.created_by,
      m.updated_at,
      m.updated_by,
      (SELECT COUNT(*) FROM [mds_meta].[entity] e WHERE e.model_id = m.id) AS entity_count
    FROM [mds_meta].[model] m
    ORDER BY m.name
  `)
  return { ok: true, data: results }
}

export async function getModel(id: number): Promise<ServiceResult<Model>> {
  const results = await dbQuery<Model>('SELECT * FROM mds_meta.model WHERE id = @id', { id })
  if (results.length === 0) {
    return { ok: false, status: 404, error: 'Model not found' }
  }
  return { ok: true, data: results[0] }
}

export interface CreateModelInput {
  code: string
  name: string
  description?: string | null
  source_database?: string | null
  target_schema?: string | null
  created_by?: string
}

export async function createModel(input: CreateModelInput): Promise<ServiceResult<Model>> {
  const { code, name, description, source_database, target_schema, created_by = 'admin' } = input

  if (!code || !name) {
    return { ok: false, status: 400, error: 'Model code and name are required' }
  }

  const existing = await dbQuery<{ id: number }>(
    'SELECT id FROM [mds_meta].[model] WHERE code = @code',
    { code }
  )
  if (existing.length > 0) {
    return { ok: false, status: 409, error: 'Model with this code already exists' }
  }

  await dbExecute(
    `INSERT INTO [mds_meta].[model]
      (code, name, description, source_database, target_schema, created_by, updated_by)
     VALUES (@code, @name, @description, @source_database, @target_schema, @user, @user)`,
    {
      code,
      name,
      description: description || null,
      source_database: source_database || null,
      target_schema: target_schema || null,
      user: created_by
    }
  )

  const created = await dbQuery<Model>('SELECT * FROM [mds_meta].[model] WHERE code = @code', { code })
  return { ok: true, data: created[0] }
}

export interface UpdateModelInput {
  name?: string
  description?: string | null
  status?: string
  source_database?: string | null
  target_schema?: string | null
  updated_by?: string
}

// Preserves the internal route's exact prior response shape (entity_id/model_id
// + a client-generated timestamp, not a fresh DB read). Callers that need the
// full updated resource (v1 PUT) should follow up with getModel(id).
export async function updateModel(id: number, input: UpdateModelInput): Promise<ServiceResult<{ model_id: number; updated_at: string }>> {
  const { name, description, status, source_database, target_schema, updated_by = 'admin' } = input

  const updates: string[] = []
  const queryParams: Record<string, unknown> = { id }

  if (name !== undefined) { updates.push('name = @name'); queryParams.name = name }
  if (description !== undefined) { updates.push('description = @description'); queryParams.description = description }
  if (status !== undefined) { updates.push('status = @status'); queryParams.status = status }
  if (source_database !== undefined) { updates.push('source_database = @source_database'); queryParams.source_database = source_database }
  if (target_schema !== undefined) { updates.push('target_schema = @target_schema'); queryParams.target_schema = target_schema }

  if (updates.length === 0) {
    return { ok: false, status: 400, error: 'No fields to update' }
  }

  updates.push('updated_at = GETUTCDATE()')
  updates.push('updated_by = @updated_by')
  queryParams.updated_by = updated_by

  await dbExecute(`UPDATE mds_meta.model SET ${updates.join(', ')} WHERE id = @id`, queryParams)

  // Status cascade to entities removed a while back - entity status is now
  // controlled via schema deployment. Still needed: sweep up entities that
  // were created while this model was draft.
  if (status === 'active') {
    await backfillSchemaDeploymentForModel(id)
  }

  return { ok: true, data: { model_id: id, updated_at: new Date().toISOString() } }
}

export async function deleteModel(id: number): Promise<ServiceResult<{ success: true }>> {
  const entities = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM mds_meta.entity WHERE model_id = @id',
    { id }
  )
  if (entities[0].count > 0) {
    return { ok: false, status: 400, error: 'Cannot delete model with existing entities. Delete entities first.' }
  }

  const roleAssignments = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM mds_meta.user_role WHERE model_id = @id',
    { id }
  )
  if (roleAssignments[0].count > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot delete model: ${roleAssignments[0].count} user role assignment(s) scoped to it. Remove those first.`
    }
  }

  try {
    await dbExecute('DELETE FROM mds_meta.model WHERE id = @id', { id })
  } catch (error) {
    // Safety net for any FK constraint not covered by the checks above.
    const isFkViolation = error instanceof Error && 'number' in error && (error as { number?: number }).number === 547
    if (isFkViolation) {
      return { ok: false, status: 400, error: 'Cannot delete model: other records still reference it.' }
    }
    throw error
  }

  return { ok: true, data: { success: true } }
}
