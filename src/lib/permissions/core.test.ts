import { test } from 'node:test'
import assert from 'node:assert/strict'
import { can, hasAnyAccess, visibleScope, entityAllowed, modelAllowed, inListSql, effectiveRole, type Grant, type EntityInfo } from './core'

const entities: EntityInfo[] = [
  { id: 1, modelId: 10 }, { id: 2, modelId: 10 }, { id: 3, modelId: 20 }, { id: 4, modelId: 30 },
]

test('no grants: no access at all', () => {
  assert.equal(hasAnyAccess([]), false)
  assert.equal(can([], 'read', { entityId: 1, modelId: 10 }), false)
  const v = visibleScope([], 'read', entities)
  assert.equal(v.all, false)
  assert.equal(inListSql(v, 'e.id', 'entity'), '1=0')
})

test('roles stack: viewer reads, editor writes, approver approves, admin changes the schema', () => {
  const t = { entityId: 1, modelId: 10 }
  const g = (role: Grant['role']): Grant[] => [{ role, scope: 'model', modelId: 10 }]
  assert.deepEqual(['read', 'write', 'approve', 'schema'].map(a => can(g('viewer'), a as never, t)), [true, false, false, false])
  assert.deepEqual(['read', 'write', 'approve', 'schema'].map(a => can(g('editor'), a as never, t)), [true, true, false, false])
  assert.deepEqual(['read', 'write', 'approve', 'schema'].map(a => can(g('approver'), a as never, t)), [true, true, true, false])
  assert.deepEqual(['read', 'write', 'approve', 'schema'].map(a => can(g('admin'), a as never, t)), [true, true, true, true])
})

test('a model grant covers its entities only', () => {
  const grants: Grant[] = [{ role: 'editor', scope: 'model', modelId: 10 }]
  assert.equal(can(grants, 'write', { entityId: 1, modelId: 10 }), true)
  assert.equal(can(grants, 'write', { entityId: 3, modelId: 20 }), false)
  assert.equal(can(grants, 'write', { entityId: 3 }), false, 'without the entity\'s model the grant cannot apply')
})

test('an entity grant covers that entity, not its model siblings', () => {
  const grants: Grant[] = [{ role: 'editor', scope: 'entity', entityId: 2 }]
  assert.equal(can(grants, 'write', { entityId: 2, modelId: 10 }), true)
  assert.equal(can(grants, 'write', { entityId: 1, modelId: 10 }), false)
  const v = visibleScope(grants, 'read', entities)
  assert.deepEqual(v.all === false && [...v.entityIds], [2])
  assert.deepEqual(v.all === false && [...v.modelIds], [10], 'its model is reachable for navigation')
})

test('grants from several sources are unioned (e.g. viewer on a model + editor on one entity)', () => {
  const grants: Grant[] = [
    { role: 'viewer', scope: 'model', modelId: 10 },
    { role: 'editor', scope: 'entity', entityId: 2 },
  ]
  assert.equal(can(grants, 'write', { entityId: 1, modelId: 10 }), false)
  assert.equal(can(grants, 'write', { entityId: 2, modelId: 10 }), true)
  assert.equal(effectiveRole(grants, { entityId: 2, modelId: 10 }), 'editor')
  assert.equal(effectiveRole(grants, { entityId: 1, modelId: 10 }), 'viewer')
  assert.equal(effectiveRole(grants, { entityId: 3, modelId: 20 }), null)
})

test('system actions need a GLOBAL admin - a model admin is not enough', () => {
  assert.equal(can([{ role: 'admin', scope: 'model', modelId: 10 }], 'system'), false)
  assert.equal(can([{ role: 'approver', scope: 'global' }], 'system'), false)
  assert.equal(can([{ role: 'admin', scope: 'global' }], 'system'), true)
})

test('a model admin can change the schema inside its model only', () => {
  const grants: Grant[] = [{ role: 'admin', scope: 'model', modelId: 10 }]
  assert.equal(can(grants, 'schema', { modelId: 10 }), true)
  assert.equal(can(grants, 'schema', { modelId: 20 }), false)
})

test('visibility: global is everything, model grants expand to the model\'s entities', () => {
  assert.deepEqual(visibleScope([{ role: 'viewer', scope: 'global' }], 'read', entities), { all: true })
  const v = visibleScope([{ role: 'viewer', scope: 'model', modelId: 10 }, { role: 'viewer', scope: 'entity', entityId: 4 }], 'read', entities)
  assert.equal(v.all, false)
  if (!v.all) {
    assert.deepEqual([...v.entityIds].sort(), [1, 2, 4])
    assert.deepEqual([...v.modelIds].sort(), [10, 30])
  }
  assert.equal(entityAllowed(v, 1), true)
  assert.equal(entityAllowed(v, 3), false)
  assert.equal(modelAllowed(v, 30), true)
  assert.equal(inListSql(v, 'r.entity_id', 'entity'), 'r.entity_id IN (1,2,4)')
})

test('visibility respects the action: a viewer sees but does not "write" anything', () => {
  const grants: Grant[] = [{ role: 'viewer', scope: 'model', modelId: 10 }]
  const w = visibleScope(grants, 'write', entities)
  assert.equal(w.all, false)
  if (!w.all) assert.equal(w.entityIds.size, 0)
})

test('shared entities are readable by everyone with any permission - and by nobody without one', () => {
  const withShared: EntityInfo[] = [{ id: 1, modelId: 10 }, { id: 5, modelId: 99, shared: true }]
  const viewer: Grant[] = [{ role: 'viewer', scope: 'model', modelId: 10 }]
  assert.equal(can(viewer, 'read', { entityId: 5, modelId: 99, shared: true }), true)
  assert.equal(can(viewer, 'write', { entityId: 5, modelId: 99, shared: true }), false, 'shared is read-only')
  assert.equal(can([], 'read', { entityId: 5, modelId: 99, shared: true }), false)
  const v = visibleScope(viewer, 'read', withShared)
  assert.equal(v.all === false && v.entityIds.has(5), true)
  assert.equal(v.all === false && v.entityIds.has(1), true)
  const none = visibleScope([], 'read', withShared)
  assert.equal(none.all === false && none.entityIds.size, 0)
  const w = visibleScope(viewer, 'write', withShared)
  assert.equal(w.all === false && w.entityIds.has(5), false)
})
