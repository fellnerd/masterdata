// Pure permission logic (no database, no session) - what a set of grants allows.
//
// A grant is "role R on scope S": the roles stack (viewer < editor < approver <
// admin) and the scope is global, one model, or one entity. A user's grants come
// from several sources (their direct roles, and the Entra groups they are in) -
// the effective right is simply the union, there are no deny rules.

export type Role = 'viewer' | 'editor' | 'approver' | 'admin'
export const ROLES: Role[] = ['viewer', 'editor', 'approver', 'admin']

// read     see the model/entity, its attributes, records, master data, views
// write    create / edit / delete staged records, create commits
// approve  approve / reject commits, deploy data
// schema   change entities, attributes and views, deploy the schema
// system   everything global: create/delete models, users, permissions, settings, jobs
export type Action = 'read' | 'write' | 'approve' | 'schema' | 'system'

const ROLE_ACTIONS: Record<Role, Action[]> = {
  viewer: ['read'],
  editor: ['read', 'write'],
  approver: ['read', 'write', 'approve'],
  admin: ['read', 'write', 'approve', 'schema'],
}

export type Grant =
  | { role: Role; scope: 'global' }
  | { role: Role; scope: 'model'; modelId: number }
  | { role: Role; scope: 'entity'; entityId: number }

// What an action is about. `modelId` is optional when `entityId` is given: the
// caller (or the loader) resolves it so a model grant can apply to an entity.
export interface Target {
  modelId?: number | null
  entityId?: number | null
}

export function roleAllows(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role].includes(action)
}

export function can(grants: Grant[], action: Action, target: Target = {}): boolean {
  for (const g of grants) {
    if (action === 'system') {
      // only a global admin runs the system
      if (g.scope === 'global' && g.role === 'admin') return true
      continue
    }
    if (!roleAllows(g.role, action)) continue
    if (g.scope === 'global') return true
    if (g.scope === 'model' && target.modelId != null && g.modelId === target.modelId) return true
    if (g.scope === 'entity' && target.entityId != null && g.entityId === target.entityId) return true
  }
  return false
}

// A user without any grant has no access at all (the login gate).
export function hasAnyAccess(grants: Grant[]): boolean {
  return grants.length > 0
}

export interface EntityInfo {
  id: number
  modelId: number
}

export type Visibility = { all: true } | { all: false; entityIds: Set<number>; modelIds: Set<number> }

// Which models / entities an action is allowed on. `read` is what lists use to
// filter; the same works for `write` (e.g. entity pickers on the data entry page).
export function visibleScope(grants: Grant[], action: Action, entities: EntityInfo[]): Visibility {
  const entityIds = new Set<number>()
  const modelIds = new Set<number>()
  for (const g of grants) {
    if (!roleAllows(g.role, action)) continue
    if (g.scope === 'global') return { all: true }
    if (g.scope === 'model') {
      modelIds.add(g.modelId)
      for (const e of entities) if (e.modelId === g.modelId) entityIds.add(e.id)
    } else {
      entityIds.add(g.entityId)
      const e = entities.find(x => x.id === g.entityId)
      if (e) modelIds.add(e.modelId) // the model is visible so the entity can be reached
    }
  }
  return { all: false, entityIds, modelIds }
}

export function entityAllowed(v: Visibility, entityId: number): boolean {
  return v.all || v.entityIds.has(entityId)
}

export function modelAllowed(v: Visibility, modelId: number): boolean {
  return v.all || v.modelIds.has(modelId)
}

// SQL fragment limiting `column` to the visible ids ('1=1' when everything is visible).
// Ids are integers from our own tables, never user text.
export function inListSql(v: Visibility, column: string, kind: 'entity' | 'model'): string {
  if (v.all) return '1=1'
  const ids = [...(kind === 'entity' ? v.entityIds : v.modelIds)].filter(Number.isInteger)
  return ids.length === 0 ? '1=0' : `${column} IN (${ids.join(',')})`
}

// The strongest role in a set of grants that covers the target - used to show
// "you are editor here" in the UI.
export function effectiveRole(grants: Grant[], target: Target = {}): Role | null {
  let best: Role | null = null
  for (const g of grants) {
    const applies =
      g.scope === 'global' ||
      (g.scope === 'model' && target.modelId != null && g.modelId === target.modelId) ||
      (g.scope === 'entity' && target.entityId != null && g.entityId === target.entityId)
    if (!applies) continue
    if (best === null || ROLES.indexOf(g.role) > ROLES.indexOf(best)) best = g.role
  }
  return best
}
