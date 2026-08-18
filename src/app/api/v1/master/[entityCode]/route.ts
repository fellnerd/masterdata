import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { resolveEntityId } from '@/lib/services/entityService'

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
    const businessKey = searchParams.get('business_key')
    const includeHistory = searchParams.get('history') === 'true'
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50'), 200)
    const offset = (page - 1) * pageSize

    let where = includeHistory ? 'WHERE 1=1' : 'WHERE is_current = 1 AND is_deleted = 0'
    const qparams: Record<string, unknown> = {}
    if (businessKey) {
      where += ' AND business_key = @businessKey'
      qparams.businessKey = businessKey
    }

    const countResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM mds_master.[${resolved.table}] ${where}`,
      qparams
    )
    const total = countResult[0]?.total || 0

    const data = await dbQuery<Record<string, unknown>>(
      `SELECT * FROM mds_master.[${resolved.table}] ${where}
       ORDER BY business_key, valid_from
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...qparams, offset, pageSize }
    )

    return NextResponse.json({
      entity: resolved.entity,
      data,
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
