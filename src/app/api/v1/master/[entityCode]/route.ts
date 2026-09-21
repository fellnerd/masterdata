import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { resolveEntityId } from '@/lib/services/entityService'
import { parsePagination } from '@/lib/pagination'
import { buildFlatAttributeFilters, findUnknownQueryParam } from '@/lib/attributeFilters'
import { coerceRowByAttributeTypes } from '@/lib/typedRows'
import { typedValueExpr } from '@/lib/typedSql'
import {
  parseShaping, SHAPING_PARAMS, MAX_DISTINCT_PAGE_SIZE, listFlatColumns, loadEntityAttributes,
  resolveNames, quoteIdent, queryDistinct, formatDistinctValue,
} from '@/lib/responseShaping'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const READ_ONLY_MESSAGE = 'mds_master is read-only via the API. Write data through /api/v1/stage/records and deploy it instead.'

// Resolves an entity code to a safe, existing mds_master table name.
// The code is checked against mds_meta.entity (a trusted metadata source) and
// against a strict identifier pattern before ever being interpolated into SQL,
// which is otherwise unavoidable here since table names can't be parameterized.
// entity.code is only unique per-model, not globally - resolveEntityId
// returns 409 if the code is ambiguous across models without modelCode.
async function resolveMasterTable(
  entityCode: string,
  modelCode?: string
): Promise<{ ok: true; table: string; entity: { id: number; code: string; name: string } } | { ok: false; status: number; error: string }> {
  if (!/^[a-zA-Z0-9_]+$/.test(entityCode)) {
    return { ok: false, status: 400, error: 'Invalid entity code' }
  }

  const resolved = await resolveEntityId(entityCode, modelCode)
  if (!resolved.ok) {
    return resolved
  }

  const entities = await dbQuery<{ id: number; code: string; name: string }>(
    'SELECT id, code, name FROM mds_meta.entity WHERE id = @id',
    { id: resolved.data }
  )

  const table = entities[0].code.toLowerCase()

  const tableExists = await dbQuery<{ exists: number }>(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = 'mds_master' AND t.name = @table
     ) THEN 1 ELSE 0 END AS [exists]`,
    { table }
  )
  if (tableExists[0].exists === 0) {
    return { ok: false, status: 404, error: `Entity "${entityCode}" has not been deployed to mds_master yet` }
  }

  return { ok: true, table, entity: entities[0] }
}

// GET /api/v1/master/[entityCode] - Read-only master data (scope: master:read)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityCode: string }> }
) {
  const auth = await verifyApiToken(request, 'master:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { entityCode } = await params
  const { searchParams } = new URL(request.url)
  const resolved = await resolveMasterTable(entityCode, searchParams.get('model_code') || undefined)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  try {
    const unknownParam = findUnknownQueryParam(searchParams, ['business_key', 'history', 'page', 'pageSize', 'model_code', ...SHAPING_PARAMS])
    if (unknownParam) {
      return NextResponse.json({ error: `Unknown query parameter: ${unknownParam}` }, { status: 400 })
    }

    const shaping = parseShaping(searchParams)
    if (!shaping.ok) {
      return NextResponse.json({ error: shaping.error }, { status: shaping.status })
    }

    const businessKey = searchParams.get('business_key')
    const includeHistory = searchParams.get('history') === 'true'
    const pagination = parsePagination(searchParams, shaping.distinct ? MAX_DISTINCT_PAGE_SIZE : 200)
    if (!pagination.ok) {
      return NextResponse.json({ error: pagination.error }, { status: pagination.status })
    }
    const { page, pageSize, offset } = pagination

    let where = includeHistory ? 'WHERE 1=1' : 'WHERE is_current = 1 AND is_deleted = 0'
    const qparams: Record<string, unknown> = {}
    if (businessKey) {
      where += ' AND business_key = @businessKey'
      qparams.businessKey = businessKey
    }

    const filterResult = await buildFlatAttributeFilters(resolved.entity.id, searchParams)
    if (!filterResult.ok) {
      return NextResponse.json({ error: filterResult.error }, { status: filterResult.status })
    }
    where += filterResult.whereClause
    Object.assign(qparams, filterResult.params)

    // Attribute columns are stored as text - hand them back as their declared
    // type (numbers as JSON numbers, booleans as booleans).
    const attributes = await loadEntityAttributes(resolved.entity.id)
    const typeByCode = new Map([...attributes.values()].map(a => [a.code, a.data_type]))

    // ?fields= / ?distinct= name real columns of the master table (attributes
    // plus business_key, valid_from, ...), checked against sys.columns.
    let selectList = '*'
    if (shaping.fields || shaping.distinct) {
      const columns = await listFlatColumns('mds_master', resolved.table)
      const named = resolveNames(shaping.fields ?? [shaping.distinct!], columns)
      if (!named.ok) {
        return NextResponse.json({ error: named.error }, { status: named.status })
      }

      if (shaping.distinct) {
        const field = named.names[0]
        const attr = attributes.get(field.toLowerCase())
        const { values, total } = await queryDistinct({
          source: `mds_master.[${resolved.table}]`,
          valueExpr: attr
            ? typedValueExpr(attr.data_type, quoteIdent(field), attr.precision, attr.scale)
            : quoteIdent(field),
          where,
          params: qparams,
          offset,
          pageSize,
        })
        return NextResponse.json({
          entity: resolved.entity,
          field,
          data: values.map(v => formatDistinctValue(v, attr?.data_type)),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        })
      }

      selectList = named.names.map(quoteIdent).join(', ')
    }

    const countResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM mds_master.[${resolved.table}] ${where}`,
      qparams
    )
    const total = countResult[0]?.total || 0

    const data = await dbQuery<Record<string, unknown>>(
      `SELECT ${selectList} FROM mds_master.[${resolved.table}] ${where}
       ORDER BY business_key, valid_from
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...qparams, offset, pageSize }
    )

    return NextResponse.json({
      entity: resolved.entity,
      data: data.map(row => coerceRowByAttributeTypes(row, typeByCode)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    logger.error({ error, entityCode }, 'v1/master/[entityCode] GET failed')
    return NextResponse.json({ error: 'Failed to fetch master data', details: String(error) }, { status: 500 })
  }
}

export async function POST() {
  return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 405 })
}
export async function PUT() {
  return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 405 })
}
export async function PATCH() {
  return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 405 })
}
export async function DELETE() {
  return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 405 })
}
