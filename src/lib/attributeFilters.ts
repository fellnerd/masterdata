import { dbQuery } from '@/lib/db-server'

export interface RecordFilterClause {
  whereClause: string
  params: Record<string, unknown>
}

export type RecordFilterResult =
  | ({ ok: true } & RecordFilterClause)
  | { ok: false; status: number; error: string }

const ATTR_PARAM_RE = /^attr\.([a-zA-Z0-9_]+)(\.(min|max|from|to|exact))?$/

interface AttrFilter {
  code: string
  kind: 'eq' | 'min' | 'max' | 'from' | 'to' | 'exact'
  value: string
}

// Builds the WHERE clause + bound params for GET /api/records and
// GET /api/v1/stage/records - both routes had this logic duplicated
// identically, so it lives here once now.
//
// Supports the existing entity_id/commit_id/status filters plus attribute-
// value filters: `attr.<code>=value` (equality for boolean/reference,
// case-insensitive contains for string), `attr.<code>.min=`/`.max=`
// (numeric range, integer/decimal), `attr.<code>.from=`/`.to=` (date range,
// date/datetime), `attr.<code>.exact=value` (opt-in exact match instead of
// contains - only meaningful for string; other types are already exact).
// entity_id is required whenever any attr.* filter is used, since attribute
// codes are entity-scoped.
//
// Attribute codes can't be bound as SQL parameters (they become part of a
// JSON_VALUE path string), so every code is validated against
// mds_meta.attribute for the given entity_id before being interpolated -
// unknown codes are rejected with 400, and a strict identifier regex is
// applied as defense in depth even though the code already came from a
// trusted DB lookup at that point.
export async function buildRecordFilters(searchParams: URLSearchParams): Promise<RecordFilterResult> {
  const entityId = searchParams.get('entity_id')
  const commitId = searchParams.get('commit_id')
  const status = searchParams.get('status')

  let whereClause = 'WHERE 1=1'
  const params: Record<string, unknown> = {}

  if (entityId) {
    whereClause += ' AND r.entity_id = @entityId'
    params.entityId = parseInt(entityId)
  }
  if (commitId) {
    whereClause += ' AND r.commit_id = @commitId'
    params.commitId = parseInt(commitId)
  }
  if (status) {
    whereClause += ' AND r.status = @status'
    params.status = status
  }

  const attrFilters: AttrFilter[] = []
  for (const [key, value] of searchParams.entries()) {
    const match = key.match(ATTR_PARAM_RE)
    if (!match) continue
    attrFilters.push({ code: match[1], kind: (match[3] as AttrFilter['kind']) || 'eq', value })
  }

  if (attrFilters.length === 0) {
    return { ok: true, whereClause, params }
  }

  if (!entityId) {
    return { ok: false, status: 400, error: 'entity_id is required when using attr.* filters' }
  }

  const uniqueCodes = [...new Set(attrFilters.map(f => f.code))]
  const placeholders = uniqueCodes.map((_, i) => `@code${i}`).join(', ')
  const codeParams: Record<string, string> = {}
  uniqueCodes.forEach((c, i) => { codeParams[`code${i}`] = c })

  const attrRows = await dbQuery<{ code: string; data_type: string }>(
    `SELECT code, data_type FROM mds_meta.attribute WHERE entity_id = @entityId AND code IN (${placeholders})`,
    { entityId: parseInt(entityId), ...codeParams }
  )
  const typeByCode = new Map(attrRows.map(r => [r.code, r.data_type]))

  for (const code of uniqueCodes) {
    if (!typeByCode.has(code)) {
      return { ok: false, status: 400, error: `Unknown attribute code for this entity: ${code}` }
    }
    if (!/^[a-zA-Z0-9_]+$/.test(code)) {
      return { ok: false, status: 400, error: `Invalid attribute code: ${code}` }
    }
  }

  let paramIdx = 0
  for (const filter of attrFilters) {
    const dataType = typeByCode.get(filter.code)!
    const jsonPath = `JSON_VALUE(r.data, '$.${filter.code}')`
    const pName = `attrVal${paramIdx++}`

    if (dataType === 'integer' || dataType === 'decimal') {
      const castExpr = `TRY_CAST(${jsonPath} AS DECIMAL(38,10))`
      const op = filter.kind === 'min' ? '>=' : filter.kind === 'max' ? '<=' : '='
      whereClause += ` AND ${castExpr} ${op} @${pName}`
      params[pName] = Number(filter.value)
    } else if (dataType === 'date' || dataType === 'datetime') {
      const sqlType = dataType === 'date' ? 'DATE' : 'DATETIME2'
      const castExpr = `TRY_CAST(${jsonPath} AS ${sqlType})`
      const op = filter.kind === 'from' ? '>=' : filter.kind === 'to' ? '<=' : '='
      // TRY_CAST on the column returns NULL for a bad stored value, but
      // comparing it against the raw string parameter still forces SQL
      // Server to implicitly (hard-)cast the parameter to the same type,
      // which throws instead of returning NULL - wrap the parameter in
      // TRY_CAST too so a malformed filter value degrades to "no match"
      // instead of a 500. Also: SQL Server's DATETIME2 parser rejects an
      // ISO "T"-separated datetime-local string with no seconds (what
      // <input type="datetime-local">-style pickers produce, e.g.
      // "2026-01-10T09:00") - pad on a ":00" when seconds are missing.
      const normalized = dataType === 'datetime' && /T\d{2}:\d{2}$/.test(filter.value)
        ? `${filter.value}:00`
        : filter.value
      whereClause += ` AND ${castExpr} ${op} TRY_CAST(@${pName} AS ${sqlType})`
      params[pName] = normalized
    } else if (dataType === 'boolean') {
      whereClause += ` AND TRY_CAST(${jsonPath} AS BIT) = @${pName}`
      params[pName] = filter.value === 'true' || filter.value === '1' ? 1 : 0
    } else if (dataType === 'reference') {
      // Exact match only - deliberately not "contains" like string, since a
      // reference value is a business key, not free text.
      whereClause += ` AND ${jsonPath} = @${pName}`
      params[pName] = filter.value
    } else if (filter.kind === 'exact') {
      // attr.<code>.exact= - opt-in exact match for an otherwise "contains"
      // string attribute (e.g. exact-match dropdown filters).
      whereClause += ` AND ${jsonPath} = @${pName}`
      params[pName] = filter.value
    } else {
      whereClause += ` AND ${jsonPath} LIKE @${pName}`
      params[pName] = `%${filter.value}%`
    }
  }

  return { ok: true, whereClause, params }
}
