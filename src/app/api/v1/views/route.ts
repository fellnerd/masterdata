import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireTokenAccess, getTokenVisibility, entityAllowed, inListSql, entityIdOfRecord } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/views - List deployed, readable views (scope: views:read)
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'views:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const scope = await getTokenVisibility(auth.userId, 'read')
  if (!scope.ok) return scope.response

  try {
    const all = await dbQuery<{ entity_id: number; code: string; name: string; view_type: string; entity_code: string; entity_name: string }>(
      `SELECT v.entity_id, v.code, v.name, v.view_type, e.code AS entity_code, e.name AS entity_name
       FROM mds_meta.entity_view v
       INNER JOIN mds_meta.entity e ON e.id = v.entity_id
       WHERE v.is_deployed = 1 AND v.is_active = 1
       ORDER BY v.code`
    )

    const views = all
      .filter(v => entityAllowed(scope.visibility, v.entity_id))
      .map(({ entity_id: _entityId, ...v }) => v)
    return NextResponse.json({ data: views, total: views.length })
  } catch (error) {
    logger.error({ error }, 'v1/views GET failed')
    return NextResponse.json({ error: 'Failed to list views', details: String(error) }, { status: 500 })
  }
}
