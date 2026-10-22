import { dbQuery } from '@/lib/db-server'
import type { ServiceResult } from './types'

// The choices of a reference attribute ("which Hauptgruppe?"): the referenced
// entity's records as (business key, label) pairs.
//
// This is deliberately NOT a read on the referenced entity: someone who may edit
// ASCEM records has to be able to pick from EPD or shared reference data without
// being allowed to browse them. The caller is checked against the REFERENCING
// attribute's entity (the form they are filling in); what comes back is only the
// business key and the configured display field - never the other columns.

export interface LookupOption {
  business_key: string
  label: string
}

const IDENT_RE = /^[a-zA-Z0-9_]+$/

export interface LookupParams {
  /** Value of the cascade parent attribute (narrows the list when the attribute is a cascade child). */
  parentValue?: string | null
  /** Text the business key or label must contain. */
  query?: string | null
  limit?: number
}

export async function lookupReferenceOptions(
  attributeId: number,
  params: LookupParams = {}
): Promise<ServiceResult<{ attribute_entity_id: number; data: LookupOption[]; total: number }>> {
  const attrs = await dbQuery<{
    entity_id: number
    data_type: string
    reference_entity_id: number | null
    reference_display_attribute: string | null
    cascade_parent_attribute: string | null
    cascade_filter_attribute: string | null
  }>(
    `SELECT entity_id, data_type, reference_entity_id, reference_display_attribute,
            cascade_parent_attribute, cascade_filter_attribute
     FROM mds_meta.attribute WHERE id = @id`,
    { id: attributeId }
  )
  const attr = attrs[0]
  if (!attr) return { ok: false, status: 404, error: 'Attribute not found' }
  if (attr.data_type !== 'reference' || !attr.reference_entity_id) {
    return { ok: false, status: 400, error: 'Attribute is not a reference' }
  }

  // JSON paths are interpolated, so only identifier-shaped codes from our own metadata
  const display = attr.reference_display_attribute
  const filter = attr.cascade_filter_attribute
  if ((display && !IDENT_RE.test(display)) || (filter && !IDENT_RE.test(filter))) {
    return { ok: false, status: 400, error: 'Invalid reference configuration' }
  }

  const labelExpr = display ? `COALESCE(NULLIF(JSON_VALUE(r.data, '$.${display}'), ''), r.business_key)` : 'r.business_key'
  let where = "r.entity_id = @refEntityId AND r.operation <> 'DELETE'"
  const sqlParams: Record<string, unknown> = { refEntityId: attr.reference_entity_id }

  const parent = params.parentValue?.trim()
  if (parent && attr.cascade_parent_attribute && filter) {
    where += ` AND JSON_VALUE(r.data, '$.${filter}') = @parent`
    sqlParams.parent = parent
  }
  const q = params.query?.trim()
  if (q) {
    where += ` AND (r.business_key LIKE @q OR ${labelExpr} LIKE @q)`
    sqlParams.q = `%${q.replace(/[%_[]/g, ch => `[${ch}]`)}%`
  }

  const limit = Math.min(Math.max(params.limit ?? 500, 1), 1000)
  const rows = await dbQuery<LookupOption & { total: number }>(
    `SELECT TOP (${limit}) r.business_key, ${labelExpr} AS label, COUNT(*) OVER () AS total
     FROM mds_stage.staged_record r
     WHERE ${where}
     ORDER BY ${display ? `${labelExpr}, r.business_key` : 'r.business_key'}`,
    sqlParams
  )

  return {
    ok: true,
    data: {
      attribute_entity_id: attr.entity_id,
      data: rows.map(r => ({ business_key: r.business_key, label: r.label })),
      total: rows[0]?.total ?? 0,
    },
  }
}
