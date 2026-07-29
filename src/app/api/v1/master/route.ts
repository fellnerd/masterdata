import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/master - List entities that have a deployed mds_master table (scope: master:read)
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'master:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const entities = await dbQuery<{ code: string; name: string }>(
      `SELECT e.code, e.name
       FROM mds_meta.entity e
       WHERE EXISTS (
         SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = 'mds_master' AND t.name = e.code
       )
       ORDER BY e.code`
    )

    return NextResponse.json({
      data: entities.map(e => ({ code: e.code, name: e.name })),
      total: entities.length,
    })
  } catch (error) {
    logger.error({ error }, 'v1/master GET failed')
    return NextResponse.json({ error: 'Failed to list master entities', details: String(error) }, { status: 500 })
  }
}
