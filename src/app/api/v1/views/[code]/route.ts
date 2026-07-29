import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const READ_ONLY_MESSAGE = 'mds_view is read-only via the API.'

async function resolveView(code: string): Promise<{ ok: true; table: string } | { ok: false; status: number; error: string }> {
  if (!/^[a-zA-Z0-9_]+$/.test(code)) {
    return { ok: false, status: 400, error: 'Invalid view code' }
  }

  const views = await dbQuery<{ code: string }>(
    'SELECT code FROM mds_meta.entity_view WHERE code = @code AND is_deployed = 1 AND is_active = 1',
    { code }
  )
  if (views.length === 0) {
    return { ok: false, status: 404, error: `Unknown or undeployed view: ${code}` }
  }

  return { ok: true, table: views[0].code.toLowerCase() }
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
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50'), 200)
    const offset = (page - 1) * pageSize

    const countResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM mds_view.[${resolved.table}]`
    )
    const total = countResult[0]?.total || 0

    const data = await dbQuery<Record<string, unknown>>(
      `SELECT * FROM mds_view.[${resolved.table}]
       ORDER BY (SELECT NULL)
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { offset, pageSize }
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
