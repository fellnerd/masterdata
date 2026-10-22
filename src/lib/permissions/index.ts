import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { dbQuery } from '@/lib/db-server'
import {
  can, hasAnyAccess, visibleScope, effectiveRole, roleAllows,
  type Action, type EntityInfo, type Grant, type Role, type Target, type Visibility,
} from './core'

export * from './core'

// Who is asking: the mds_meta.user row plus the Entra groups of their session.
export interface Principal {
  userId: number
  email: string
  tenantId?: string
  groupIds: string[]
}

// ---- small per-process cache -------------------------------------------------
// Grants are re-read from the database every few seconds, never kept in the JWT:
// a removed permission must stop working without waiting for the session to end.
const TTL_MS = 15_000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

// Call after any change to permissions, groups or entities/models.
export function clearPermissionCache(): void {
  cache.clear()
}

// ---- loading -----------------------------------------------------------------

export async function loadEntityInfos(): Promise<EntityInfo[]> {
  return cached('entities', async () => {
    const rows = await dbQuery<{ id: number; model_id: number }>('SELECT id, model_id FROM mds_meta.entity')
    return rows.map(r => ({ id: r.id, modelId: r.model_id }))
  })
}

interface GrantRow {
  role: Role
  scope_type: 'global' | 'model' | 'entity'
  model_id: number | null
  entity_id: number | null
}

function toGrant(r: GrantRow): Grant | null {
  if (r.scope_type === 'global') return { role: r.role, scope: 'global' }
  if (r.scope_type === 'model' && r.model_id != null) return { role: r.role, scope: 'model', modelId: r.model_id }
  if (r.scope_type === 'entity' && r.entity_id != null) return { role: r.role, scope: 'entity', entityId: r.entity_id }
  return null
}

export async function loadGrants(p: Principal): Promise<Grant[]> {
  const key = `grants:${p.userId}:${p.tenantId ?? ''}:${[...p.groupIds].sort().join(',')}`
  return cached(key, async () => {
    const grants: Grant[] = []

    // direct, legacy roles (global, or per model when model_id is set)
    const direct = await dbQuery<{ role: Role; model_id: number | null }>(
      'SELECT role, model_id FROM mds_meta.user_role WHERE user_id = @userId',
      { userId: p.userId }
    )
    for (const r of direct) {
      grants.push(r.model_id == null ? { role: r.role, scope: 'global' } : { role: r.role, scope: 'model', modelId: r.model_id })
    }

    // permissions granted to the user directly
    const own = await dbQuery<GrantRow>(
      `SELECT role, scope_type, model_id, entity_id FROM mds_meta.permission
       WHERE subject_type = 'user' AND user_id = @userId`,
      { userId: p.userId }
    )
    for (const r of own) { const g = toGrant(r); if (g) grants.push(g) }

    // permissions granted to the Entra groups of this sign-in
    if (p.tenantId && p.groupIds.length > 0) {
      const params: Record<string, unknown> = { tenantId: p.tenantId }
      const placeholders = p.groupIds.map((id, i) => { params[`g${i}`] = id; return `@g${i}` }).join(', ')
      const viaGroups = await dbQuery<GrantRow>(
        `SELECT p.role, p.scope_type, p.model_id, p.entity_id
         FROM mds_meta.permission p
         JOIN mds_meta.entra_group g ON g.id = p.entra_group_id
         WHERE p.subject_type = 'entra_group' AND g.tenant_id = @tenantId AND g.object_id IN (${placeholders})`,
        params
      )
      for (const r of viaGroups) { const g = toGrant(r); if (g) grants.push(g) }
    }

    return grants
  })
}

async function userIdByEmail(email: string): Promise<number | null> {
  return cached(`user:${email.toLowerCase()}`, async () => {
    const rows = await dbQuery<{ id: number; status: string }>(
      'SELECT id, status FROM mds_meta.[user] WHERE email = @email',
      { email }
    )
    // an inactive user keeps their row but no longer has access
    return rows[0] && rows[0].status !== 'inactive' ? rows[0].id : null
  })
}

// The principal of the signed-in session, or null when nobody is signed in.
export async function principalFromSession(): Promise<Principal | null> {
  const session = await auth()
  const user = session?.user as { email?: string | null; groups?: string[]; tenantId?: string } | undefined
  if (!user?.email) return null
  const userId = await userIdByEmail(user.email)
  if (userId === null) return null
  return { userId, email: user.email, tenantId: user.tenantId, groupIds: user.groups ?? [] }
}

// The principal behind an API token: it has no sign-in, so its groups are the
// snapshot taken at the owner's last sign-in.
export async function principalFromUserId(userId: number): Promise<Principal | null> {
  return cached(`tokenprincipal:${userId}`, async () => {
    const users = await dbQuery<{ email: string; status: string }>(
      'SELECT email, status FROM mds_meta.[user] WHERE id = @userId',
      { userId }
    )
    if (!users[0] || users[0].status === 'inactive') return null
    const groups = await dbQuery<{ tenant_id: string; object_id: string }>(
      `SELECT g.tenant_id, g.object_id
       FROM mds_meta.user_entra_group ug JOIN mds_meta.entra_group g ON g.id = ug.entra_group_id
       WHERE ug.user_id = @userId`,
      { userId }
    )
    // all of a user's groups come from the one tenant they signed in through
    return { userId, email: users[0].email, tenantId: groups[0]?.tenant_id, groupIds: groups.map(g => g.object_id) }
  })
}

// ---- checks ------------------------------------------------------------------

export async function resolveTarget(target: Target): Promise<Target> {
  if (target.entityId != null && target.modelId == null) {
    const entity = (await loadEntityInfos()).find(e => e.id === target.entityId)
    return { entityId: target.entityId, modelId: entity?.modelId ?? null }
  }
  return target
}

export async function principalCan(p: Principal, action: Action, target: Target = {}): Promise<boolean> {
  return can(await loadGrants(p), action, await resolveTarget(target))
}

export async function principalVisibility(p: Principal, action: Action = 'read'): Promise<Visibility> {
  return visibleScope(await loadGrants(p), action, await loadEntityInfos())
}

export async function principalHasAccess(p: Principal): Promise<boolean> {
  return hasAnyAccess(await loadGrants(p))
}

// What the signed-in user may do - for the UI gate and menus.
export async function accessSummary(p: Principal) {
  const grants = await loadGrants(p)
  return {
    hasAccess: hasAnyAccess(grants),
    isSystemAdmin: can(grants, 'system'),
    role: effectiveRole(grants), // strongest global role, if any
    grants,
  }
}

// ---- route helpers (session) --------------------------------------------------

function forbidden(message: string, code: 'no_access' | 'forbidden' = 'forbidden') {
  return NextResponse.json({ error: message, code }, { status: 403 })
}

// Returns a ready-to-return response when the signed-in user may NOT do `action`
// on `target`, or null when the route can proceed. Without a target, the action
// must be allowed somewhere (use for "any editor").
export async function requireAccess(action: Action, target: Target = {}): Promise<NextResponse | null> {
  const p = await principalFromSession()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const grants = await loadGrants(p)
  if (!hasAnyAccess(grants)) return forbidden('No access: your account has no permission in this system', 'no_access')

  const resolved = await resolveTarget(target)
  const hasTarget = resolved.entityId != null || resolved.modelId != null
  // no target: the action must be allowed somewhere (e.g. "may this user write anywhere?")
  const allowed = hasTarget
    ? can(grants, action, resolved)
    : action === 'system'
      ? can(grants, 'system')
      : grants.some(g => roleAllows(g.role, action))
  return allowed ? null : forbidden(`Forbidden: this needs the ${action} permission${hasTarget ? ' on this model/entity' : ''}`)
}

// The visible models/entities of the signed-in user for a list endpoint, or the
// error response when nobody is signed in / has no access at all.
export async function getVisibility(
  action: Action = 'read'
): Promise<{ ok: true; visibility: Visibility; principal: Principal } | { ok: false; response: NextResponse }> {
  const p = await principalFromSession()
  if (!p) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await principalHasAccess(p))) return { ok: false, response: forbidden('No access: your account has no permission in this system', 'no_access') }
  return { ok: true, visibility: await principalVisibility(p, action), principal: p }
}

// ---- route helpers (API token) --------------------------------------------------
// Token scopes (stage:write, master:read, ...) stay the outer limit; these add
// the model/entity part on top, evaluated live for the token's owner.

export async function requireTokenAccess(userId: number, action: Action, target: Target = {}): Promise<NextResponse | null> {
  const p = await principalFromUserId(userId)
  if (!p) return forbidden('Forbidden: the token owner is inactive or unknown')
  const grants = await loadGrants(p)
  if (!hasAnyAccess(grants)) return forbidden('No access: the token owner has no permission in this system', 'no_access')
  const resolved = await resolveTarget(target)
  return can(grants, action, resolved) ? null : forbidden(`Forbidden: the token owner lacks the ${action} permission on this model/entity`)
}

export async function getTokenVisibility(
  userId: number,
  action: Action = 'read'
): Promise<{ ok: true; visibility: Visibility } | { ok: false; response: NextResponse }> {
  const p = await principalFromUserId(userId)
  if (!p) return { ok: false, response: forbidden('Forbidden: the token owner is inactive or unknown') }
  if (!(await principalHasAccess(p))) return { ok: false, response: forbidden('No access: the token owner has no permission in this system', 'no_access') }
  return { ok: true, visibility: await principalVisibility(p, action) }
}

// ---- id lookups for routes that only get a child id -----------------------------

export async function entityIdOfAttribute(attributeId: number): Promise<number | null> {
  const rows = await dbQuery<{ entity_id: number }>('SELECT entity_id FROM mds_meta.attribute WHERE id = @id', { id: attributeId })
  return rows[0]?.entity_id ?? null
}

export async function entityIdOfRecord(recordId: number): Promise<number | null> {
  const rows = await dbQuery<{ entity_id: number }>('SELECT entity_id FROM mds_stage.staged_record WHERE id = @id', { id: recordId })
  return rows[0]?.entity_id ?? null
}

export async function entityIdOfView(viewId: number): Promise<number | null> {
  const rows = await dbQuery<{ entity_id: number }>('SELECT entity_id FROM mds_meta.entity_view WHERE id = @id', { id: viewId })
  return rows[0]?.entity_id ?? null
}

// The (distinct) entities a commit touches, via its staged records.
export async function entityIdsOfCommit(commitId: number): Promise<number[]> {
  const rows = await dbQuery<{ entity_id: number }>(
    'SELECT DISTINCT entity_id FROM mds_stage.staged_record WHERE commit_id = @id',
    { id: commitId }
  )
  return rows.map(r => r.entity_id)
}

// Requires `action` on EVERY listed entity (e.g. approving a commit that spans entities).
export async function requireAccessOnAll(action: Action, entityIds: number[]): Promise<NextResponse | null> {
  if (entityIds.length === 0) return requireAccess(action)
  for (const entityId of entityIds) {
    const denied = await requireAccess(action, { entityId })
    if (denied) return denied
  }
  return null
}

export async function entityIdOfCommit(commitId: number): Promise<number | null> {
  const rows = await dbQuery<{ entity_id: number }>('SELECT entity_id FROM mds_stage.[commit] WHERE id = @id', { id: commitId })
  return rows[0]?.entity_id ?? null
}

// Own data or system admin: used where a user may manage their own record (API
// tokens, own profile) but only a global admin may touch anyone else's.
export async function requireSelfOrSystem(targetUserId: number): Promise<NextResponse | null> {
  const p = await principalFromSession()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (p.userId === targetUserId) return null
  return requireAccess('system')
}

export async function requireSelfEmailOrSystem(email: string | null): Promise<NextResponse | null> {
  const p = await principalFromSession()
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (email && p.email.toLowerCase() === email.toLowerCase()) return null
  return requireAccess('system')
}

// A single job (details / live stream): visible to users who may read the entities
// it is about; a job that is not tied to entities is system-level.
export async function requireJobAccess(data: { entityId?: number; entityIds?: number[] } | undefined): Promise<NextResponse | null> {
  const ids = [...(data?.entityIds ?? []), ...(data?.entityId != null ? [data.entityId] : [])].filter(Number.isInteger)
  return ids.length > 0 ? requireAccessOnAll('read', ids) : requireAccess('system')
}

// Grants with the model/entity names resolved, for display ("editor on ASCEM").
export async function lookupGrantTargets(grants: Grant[]) {
  const models = await dbQuery<{ id: number; code: string }>('SELECT id, code FROM mds_meta.model')
  const entities = await dbQuery<{ id: number; code: string; name: string }>('SELECT id, code, name FROM mds_meta.entity')
  return grants.map(g => ({
    role: g.role,
    scope: g.scope,
    target:
      g.scope === 'global' ? null
        : g.scope === 'model' ? models.find(m => m.id === g.modelId)?.code ?? `model ${g.modelId}`
          : entities.find(e => e.id === g.entityId)?.name ?? `entity ${g.entityId}`,
  }))
}
