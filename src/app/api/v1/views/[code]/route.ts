import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { parsePagination } from '@/lib/pagination'
import { buildFlatAttributeFilters, findUnknownQueryParam } from '@/lib/attributeFilters'
import {
  parseShaping, SHAPING_PARAMS, MAX_DISTINCT_PAGE_SIZE, listFlatColumns, loadEntityAttributes,
  resolveNames, quoteIdent, queryDistinct, formatDistinctValue,
} from '@/lib/responseShaping'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const READ_ONLY_MESSAGE = 'mds_view is read-only via the API.'

async function resolveView(code: string): Promise<{ ok: true; table: string; entityId: number } | { ok: false; status: number; error: string }> {
  if (!/^[a-zA-Z0-9_]+$/.test(code)) {
    return { ok: false, status: 400, error: 'Invalid view code' }
  }

  const views = await dbQuery<{ code: string; entity_id: number }>(
    'SELECT code, entity_id FROM mds_meta.entity_view WHERE code = @code AND is_deployed = 1 AND is_active = 1',
    { code }
  )
  if (views.length === 0) {
    return { ok: false, status: 404, error: `Unknown or undeployed view: ${code}` }
  }

  return { ok: true, table: views[0].code.toLowerCase(), entityId: views[0].entity_id }
}

// GET /api/v1/views/[code] - Read-only view data (scope: views:read)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await verifyApiToken(request, 'views:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { code } = await params
  const resolved = await resolveView(code)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  try {
    const { searchParams } = new URL(request.url)

    const unknownParam = findUnknownQueryParam(searchParams, ['page', 'pageSize', ...SHAPING_PARAMS])
    if (unknownParam) {
      return NextResponse.json({ error: `Unknown query parameter: ${unknownParam}` }, { status: 400 })
    }

    const shaping = parseShaping(searchParams)
    if (!shaping.ok) {
      return NextResponse.json({ error: shaping.error }, { status: shaping.status })
    }

    const pagination = parsePagination(searchParams, shaping.distinct ? MAX_DISTINCT_PAGE_SIZE : 200)
    if (!pagination.ok) {
      return NextResponse.json({ error: pagination.error }, { status: pagination.status })
    }
    const { page, pageSize, offset } = pagination

    const filterResult = await buildFlatAttributeFilters(resolved.entityId, searchParams)
    if (!filterResult.ok) {
      return NextResponse.json({ error: filterResult.error }, { status: filterResult.status })
    }
    const where = `WHERE 1=1${filterResult.whereClause}`

    // ?fields= / ?distinct= name real columns of the view (which - unlike a
    // master table - can have aliases or custom columns), checked against
    // sys.columns. A (re)deployed view already exposes typed columns, so the
    // values need no cast here.
    let selectList = '*'
    if (shaping.fields || shaping.distinct) {
      const columns = await listFlatColumns('mds_view', resolved.table)
      const named = resolveNames(shaping.fields ?? [shaping.distinct!], columns)
      if (!named.ok) {
        return NextResponse.json({ error: named.error }, { status: named.status })
      }

      if (shaping.distinct) {
        const field = named.names[0]
        const attributes = await loadEntityAttributes(resolved.entityId)
        const { values, total } = await queryDistinct({
          source: `mds_view.[${resolved.table}]`,
          valueExpr: quoteIdent(field),
          where,
          params: filterResult.params,
          offset,
          pageSize,
        })
        return NextResponse.json({
          field,
          data: values.map(v => formatDistinctValue(v, attributes.get(field.toLowerCase())?.data_type)),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        })
      }

      selectList = named.names.map(quoteIdent).join(', ')
    }

    const countResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM mds_view.[${resolved.table}] ${where}`,
      filterResult.params
    )
    const total = countResult[0]?.total || 0

    const data = await dbQuery<Record<string, unknown>>(
      `SELECT ${selectList} FROM mds_view.[${resolved.table}] ${where}
       ORDER BY (SELECT NULL)
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...filterResult.params, offset, pageSize }
    )

    return NextResponse.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  } catch (error) {
    logger.error({ error, code }, 'v1/views/[code] GET failed')
    return NextResponse.json({ error: 'Failed to fetch view data', details: String(error) }, { status: 500 })
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
