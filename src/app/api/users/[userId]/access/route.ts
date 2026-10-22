import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import {
  requireAccess, loadSourcedGrants, loadEntityInfos, lookupGrantTargets, visibleScope, can, roleAllows,
  type Principal,
} from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/users/[userId]/access - what a user can do and WHY (global admin only).
// Groups are the snapshot of the user's last sign-in - the same data API tokens use.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const denied = await requireAccess('system')
  if (denied) return denied

  const { userId } = await params
  try {
    const id = parseInt(userId)
    const users = await dbQuery<{ id: number; email: string; name: string | null; status: string; last_login_at: string | null }>(
      'SELECT id, email, name, status, last_login_at FROM mds_meta.[user] WHERE id = @id',
      { id }
    )
    if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const groups = await dbQuery<{ tenant_id: string; object_id: string; display_name: string | null; kind: string }>(
      `SELECT g.tenant_id, g.object_id, g.display_name, g.kind
       FROM mds_meta.user_entra_group ug JOIN mds_meta.entra_group g ON g.id = ug.entra_group_id
       WHERE ug.user_id = @id`,
      { id }
    )
    const principal: Principal = {
      userId: id,
      email: users[0].email,
      tenantId: groups[0]?.tenant_id,
      groupIds: groups.filter(g => g.kind === 'group').map(g => g.object_id),
    }

    const sourced = await loadSourcedGrants(principal)
    const grants = sourced.map(s => s.grant)
    const targets = await lookupGrantTargets(grants)

    const infos = await loadEntityInfos()
    const entityRows = await dbQuery<{ id: number; name: string; model_code: string }>(
      'SELECT e.id, e.name, m.code AS model_code FROM mds_meta.entity e JOIN mds_meta.model m ON m.id = e.model_id ORDER BY m.code, e.name'
    )
    const entitiesFor = (action: 'read' | 'write' | 'approve' | 'schema') => {
      const v = visibleScope(grants, action, infos)
      return entityRows.filter(e => v.all || v.entityIds.has(e.id)).map(e => ({ id: e.id, name: e.name, model: e.model_code }))
    }

    return NextResponse.json({
      user: users[0],
      active: users[0].status !== 'inactive',
      groups: groups.filter(g => g.kind === 'group').map(g => ({ object_id: g.object_id, name: g.display_name })),
      grants: sourced.map((s, i) => ({ ...targets[i], source: s.source })),
      capabilities: {
        write: grants.some(g => roleAllows(g.role, 'write')),
        approve: grants.some(g => roleAllows(g.role, 'approve')),
        schema: grants.some(g => roleAllows(g.role, 'schema')),
        system: can(grants, 'system'),
      },
      readable: entitiesFor('read'),
      writable: entitiesFor('write'),
      approvable: entitiesFor('approve'),
      schema: entitiesFor('schema'),
    })
  } catch (error) {
    logger.error({ error, userId }, 'GET /api/users/[userId]/access failed')
    return NextResponse.json({ error: 'Failed to load access', details: String(error) }, { status: 500 })
  }
}
