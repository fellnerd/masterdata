import { dbQuery } from '@/lib/db-server'

// ?fields= and ?distinct= for the three GET read endpoints
// (/stage/records, /master/{entityCode}, /views/{code}).
//
//   fields=a,b,c   only these fields in every returned row (payload trimming
//                  for models with many attributes)
//   distinct=a     instead of rows, the unique non-null values of one field,
//                  sorted, paginated - the building block for dropdown filters
//                  (combine with attr.* filters for cascading / lazy-loaded
//                  hierarchies)
//
// Field names can't be bound as SQL parameters (they become column names or
// JSON paths), so every name is checked against a trusted list first - the
// real column list of the table/view, or the entity's attribute codes - and
// only that trusted spelling is ever interpolated.

const IDENT_RE = /^[a-zA-Z0-9_]+$/

// Values are single scalars, so a distinct page can be a lot bigger than a
// page of rows before it becomes a payload problem.
export const MAX_DISTINCT_PAGE_SIZE = 1000

export const SHAPING_PARAMS = ['fields', 'distinct']

type Failure = { ok: false; status: number; error: string }

export type ShapingResult =
  | { ok: true; fields: string[] | null; distinct: string | null }
  | Failure

export function parseShaping(searchParams: URLSearchParams): ShapingResult {
  let fields: string[] | null = null
  let distinct: string | null = null

  if (searchParams.has('fields')) {
    const seen = new Set<string>()
    fields = []
    for (const raw of searchParams.getAll('fields').join(',').split(',')) {
      const name = raw.trim()
      if (name === '') continue
      if (!IDENT_RE.test(name)) return { ok: false, status: 400, error: `Invalid field name: ${name}` }
      if (seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      fields.push(name)
    }
    if (fields.length === 0) {
      return { ok: false, status: 400, error: 'fields must name at least one field, e.g. fields=code,name' }
    }
  }

  if (searchParams.has('distinct')) {
    const values = searchParams.getAll('distinct')
    const name = (values[0] ?? '').trim()
    if (values.length > 1 || name.includes(',')) {
      return { ok: false, status: 400, error: 'distinct takes exactly one field' }
    }
    if (name === '') {
      return { ok: false, status: 400, error: 'distinct must name a field, e.g. distinct=country' }
    }
    if (!IDENT_RE.test(name)) return { ok: false, status: 400, error: `Invalid field name: ${name}` }
    distinct = name
  }

  if (fields && distinct) {
    return { ok: false, status: 400, error: 'fields and distinct cannot be combined - distinct already returns just that one field' }
  }

  return { ok: true, fields, distinct }
}

export function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

// Real column names of a master table / view, keyed by lower-case name.
export async function listFlatColumns(
  schema: 'mds_master' | 'mds_view',
  table: string
): Promise<Map<string, string>> {
  const rows = await dbQuery<{ name: string }>(
    `SELECT c.name
     FROM sys.columns c
     JOIN sys.objects o ON o.object_id = c.object_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id
     WHERE s.name = @schema AND o.name = @table
     ORDER BY c.column_id`,
    { schema, table }
  )
  return new Map(rows.map(r => [r.name.toLowerCase(), r.name]))
}

export interface AttributeMeta {
  code: string
  data_type: string
  precision: number | null
  scale: number | null
}

// All attributes of an entity, keyed by lower-case code.
export async function loadEntityAttributes(entityId: number): Promise<Map<string, AttributeMeta>> {
  const rows = await dbQuery<AttributeMeta>(
    'SELECT code, data_type, [precision], scale FROM mds_meta.attribute WHERE entity_id = @entityId ORDER BY sort_order',
    { entityId }
  )
  return new Map(rows.map(r => [r.code.toLowerCase(), r]))
}

// Maps requested names to their real spelling (case-insensitive lookup) or
// fails on the first unknown one. `known` is either a column map or an
// attribute map - both are keyed by lower-case name.
export function resolveNames(
  requested: string[],
  known: Map<string, string | AttributeMeta>
): { ok: true; names: string[] } | Failure {
  const names: string[] = []
  for (const name of requested) {
    const hit = known.get(name.toLowerCase())
    if (hit === undefined) return { ok: false, status: 400, error: `Unknown field: ${name}` }
    names.push(typeof hit === 'string' ? hit : hit.code)
  }
  return { ok: true, names }
}

export interface DistinctQuery {
  // FROM target including alias, e.g. "mds_master.[units]"
  source: string
  // SQL expression producing the (typed) value
  valueExpr: string
  // "WHERE ..." incl. keyword
  where: string
  params: Record<string, unknown>
  offset: number
  pageSize: number
}

// NULLs are left out: an "unset" entry is useless in a dropdown, and a caller
// that wants to know whether NULLs exist can compare against the plain row
// count.
export async function queryDistinct(q: DistinctQuery): Promise<{ values: unknown[]; total: number }> {
  const cte = `WITH d AS (SELECT DISTINCT ${q.valueExpr} AS v FROM ${q.source} ${q.where})`

  const count = await dbQuery<{ total: number }>(
    `${cte} SELECT COUNT(*) AS total FROM d WHERE v IS NOT NULL`,
    q.params
  )
  const rows = await dbQuery<{ v: unknown }>(
    `${cte} SELECT v FROM d WHERE v IS NOT NULL
     ORDER BY v
     OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
    { ...q.params, offset: q.offset, pageSize: q.pageSize }
  )

  return { values: rows.map(r => r.v), total: count[0]?.total || 0 }
}

// The driver hands DATE/DATETIME2 back as JS Dates; a date-only attribute
// reads better as "2026-01-31" than as "2026-01-31T00:00:00.000Z".
export function formatDistinctValue(value: unknown, dataType?: string): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString()
    return dataType === 'date' ? iso.slice(0, 10) : iso
  }
  return value
}

// Keeps only `fields` (already resolved to their real spelling) of a JSON
// object, in the requested order; keys the object doesn't have are omitted.
export function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f]
  }
  return out
}
