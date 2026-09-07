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

// A query param that isn't in `allowedExact` and doesn't look like an
// attr.* filter is very likely a typo or a param that's valid on a
// *different* endpoint (e.g. ?business_key= on /stage/records, which is
// only meaningful on /master/{code}) - rather than silently no-op'ing and
// returning an unfiltered page, callers should treat this as a 400. Returns
// the first offending param name, or null if every param is recognized.
export function findUnknownQueryParam(searchParams: URLSearchParams, allowedExact: string[]): string | null {
  for (const key of searchParams.keys()) {
    if (allowedExact.includes(key)) continue
    if (ATTR_PARAM_RE.test(key)) continue
    return key
  }
  return null
}

// Shared across buildRecordFilters (JSON-blob staged records) and
// buildFlatAttributeFilters (flat-column master/view tables): parses every
// `attr.<code>` / `attr.<code>.<min|max|from|to|exact>` query param into a
// flat list, in the order given.
function parseAttrParams(searchParams: URLSearchParams): AttrFilter[] {
  const attrFilters: AttrFilter[] = []
  for (const [key, value] of searchParams.entries()) {
    const match = key.match(ATTR_PARAM_RE)
    if (!match) continue
    attrFilters.push({ code: match[1], kind: (match[3] as AttrFilter['kind']) || 'eq', value })
  }
  return attrFilters
}

// Shared attribute-code validation: every code referenced by an attr.*
// filter must exist on mds_meta.attribute for the given entity (entity-
// scoped, since attribute codes aren't globally unique) - unknown codes are
// rejected with 400 before anything gets interpolated into SQL. Returns the
// code -> data_type map on success.
async function resolveAttrTypes(
  entityId: number,
  codes: string[]
): Promise<{ ok: true; typeByCode: Map<string, string> } | { ok: false; status: number; error: string }> {
  const placeholders = codes.map((_, i) => `@code${i}`).join(', ')
  const codeParams: Record<string, string> = {}
  codes.forEach((c, i) => { codeParams[`code${i}`] = c })

  const attrRows = await dbQuery<{ code: string; data_type: string }>(
    `SELECT code, data_type FROM mds_meta.attribute WHERE entity_id = @entityId AND code IN (${placeholders})`,
    { entityId, ...codeParams }
  )
  const typeByCode = new Map(attrRows.map(r => [r.code, r.data_type]))

  for (const code of codes) {
    if (!typeByCode.has(code)) {
      return { ok: false, status: 400, error: `Unknown attribute code for this entity: ${code}` }
    }
    // Defense in depth - codes only reach here already validated against a
    // trusted DB lookup, but every code below is interpolated directly into
    // SQL text (JSON path or a bracketed column name, neither bindable as a
    // parameter), so a strict identifier check stays in place regardless.
    if (!/^[a-zA-Z0-9_]+$/.test(code)) {
      return { ok: false, status: 400, error: `Invalid attribute code: ${code}` }
    }
  }

  return { ok: true, typeByCode }
}

// Shared per-attribute clause builder: identical semantics regardless of
// whether the underlying value lives in a JSON blob (staged records) or a
// real (always NVARCHAR, per generate_mds_master_ddl/generateLoadTableDDL)
// column (master/view tables) - only how the raw value is *read* differs,
// which the caller supplies via `columnExpr`.
function buildAttrClauses(
  attrFilters: AttrFilter[],
  typeByCode: Map<string, string>,
  columnExpr: (code: string) => string
): { clause: string; params: Record<string, unknown> } {
  let clause = ''
  const params: Record<string, unknown> = {}
  let paramIdx = 0

  for (const filter of attrFilters) {
    const dataType = typeByCode.get(filter.code)!
    const valueExpr = columnExpr(filter.code)
    const pName = `attrVal${paramIdx++}`

    if (dataType === 'integer' || dataType === 'decimal') {
      const castExpr = `TRY_CAST(${valueExpr} AS DECIMAL(38,10))`
      const op = filter.kind === 'min' ? '>=' : filter.kind === 'max' ? '<=' : '='
      clause += ` AND ${castExpr} ${op} @${pName}`
      params[pName] = Number(filter.value)
    } else if (dataType === 'date' || dataType === 'datetime') {
      const sqlType = dataType === 'date' ? 'DATE' : 'DATETIME2'
      const castExpr = `TRY_CAST(${valueExpr} AS ${sqlType})`
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
      clause += ` AND ${castExpr} ${op} TRY_CAST(@${pName} AS ${sqlType})`
      params[pName] = normalized
    } else if (dataType === 'boolean') {
      clause += ` AND TRY_CAST(${valueExpr} AS BIT) = @${pName}`
      params[pName] = filter.value === 'true' || filter.value === '1' ? 1 : 0
    } else if (dataType === 'reference') {
      // Exact match only - deliberately not "contains" like string, since a
      // reference value is a business key, not free text.
      clause += ` AND ${valueExpr} = @${pName}`
      params[pName] = filter.value
    } else if (filter.kind === 'exact') {
      // attr.<code>.exact= - opt-in exact match for an otherwise "contains"
      // string attribute (e.g. exact-match dropdown filters).
      clause += ` AND ${valueExpr} = @${pName}`
      params[pName] = filter.value
    } else {
      clause += ` AND ${valueExpr} LIKE @${pName}`
      params[pName] = `%${filter.value}%`
    }
  }

  return { clause, params }
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

  const attrFilters = parseAttrParams(searchParams)
  if (attrFilters.length === 0) {
    return { ok: true, whereClause, params }
  }

  if (!entityId) {
    return { ok: false, status: 400, error: 'entity_id is required when using attr.* filters' }
  }

  const uniqueCodes = [...new Set(attrFilters.map(f => f.code))]
  const resolved = await resolveAttrTypes(parseInt(entityId), uniqueCodes)
  if (!resolved.ok) {
    return resolved
  }

  const { clause, params: attrParams } = buildAttrClauses(
    attrFilters,
    resolved.typeByCode,
    code => `JSON_VALUE(r.data, '$.${code}')`
  )
  whereClause += clause
  Object.assign(params, attrParams)

  return { ok: true, whereClause, params }
}

// Same attr.* filtering as buildRecordFilters, but for a flat table where
// every attribute is its own real column (mds_master.<entity> /
// mds_view.<code>) rather than a JSON blob - used by GET /api/v1/master/{code}
// and GET /api/v1/views/{code}. The caller already knows entityId (resolved
// from the URL path, not a query param here), and supplies its own base
// WHERE/params (business_key, is_current, etc.) - this only ever returns an
// additive ` AND ...` fragment (or '' when no attr.* params are present) to
// append to it.
export async function buildFlatAttributeFilters(
  entityId: number,
  searchParams: URLSearchParams
): Promise<RecordFilterResult> {
  const attrFilters = parseAttrParams(searchParams)
  if (attrFilters.length === 0) {
    return { ok: true, whereClause: '', params: {} }
  }

  const uniqueCodes = [...new Set(attrFilters.map(f => f.code))]
  const resolved = await resolveAttrTypes(entityId, uniqueCodes)
  if (!resolved.ok) {
    return resolved
  }

  const { clause, params } = buildAttrClauses(
    attrFilters,
    resolved.typeByCode,
    code => `[${code}]`
  )

  return { ok: true, whereClause: clause, params }
}
