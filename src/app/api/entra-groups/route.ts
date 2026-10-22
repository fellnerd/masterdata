import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { lookupEntraGroups } from '@/lib/entraGroups'
import { requireAccess } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/entra-groups?tenant_id=<tid>&ids=<id>,<id> - names of Entra groups MDS has seen.
// Behind the normal session gate; returns only ids and names.
export async function GET(request: NextRequest) {
  // group names for the profile / permission screens
  const denied = await requireAccess('read')
  if (denied) return denied

  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenant_id') ?? ''
    const ids = (searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    // object ids are GUIDs - anything else is not an Entra id
    if (!/^[0-9a-fA-F-]{36}$/.test(tenantId) || ids.some(id => !/^[0-9a-fA-F-]{36}$/.test(id))) {
      return NextResponse.json({ error: 'tenant_id and ids must be GUIDs' }, { status: 400 })
    }
    return NextResponse.json({ data: await lookupEntraGroups(tenantId, ids) })
  } catch (error) {
    logger.error({ error }, 'GET /api/entra-groups failed')
    return NextResponse.json({ error: 'Failed to load groups', details: String(error) }, { status: 500 })
  }
}
