import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { principalFromSession, loadGrants, can, hasAnyAccess, roleAllows, lookupGrantTargets } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/me/access - what the signed-in user may do, for the UI (menu, "no access" screen).
// Never an error for a user without permissions: that user gets hasAccess=false.
export async function GET() {
  try {
    const p = await principalFromSession()
    if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const grants = await loadGrants(p)
    return NextResponse.json({
      email: p.email,
      hasAccess: hasAnyAccess(grants),
      capabilities: {
        write: grants.some(g => roleAllows(g.role, 'write')),
        approve: grants.some(g => roleAllows(g.role, 'approve')),
        schema: grants.some(g => roleAllows(g.role, 'schema')),
        system: can(grants, 'system'),
      },
      grants: await lookupGrantTargets(grants),
    })
  } catch (error) {
    logger.error({ error }, 'GET /api/me/access failed')
    return NextResponse.json({ error: 'Failed to load access', details: String(error) }, { status: 500 })
  }
}
