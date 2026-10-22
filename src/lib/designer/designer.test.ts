import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDesignerGraph, selectSubgraph, entityNeighbours } from './graph'
import { toMermaid, mermaidLabel, mermaidAttributeName } from './mermaid'
import type { AttributeRow, EntityRow, ModelRow } from './types'

const models: ModelRow[] = [
  { id: 2, code: 'EPD', name: 'EPD', status: 'active' },
  { id: 1, code: 'ASCEM', name: 'Ascem', status: 'active' },
]
const entities: EntityRow[] = [
  { id: 10, code: 'pool', name: 'ASCEM EPD POOL', scd_type: 'SCD2', status: 'active', model_id: 1 },
  { id: 20, code: 'cat1', name: 'Hauptgruppe', scd_type: 'SCD1', status: 'active', model_id: 2 },
  { id: 21, code: 'cat2', name: 'Untergruppe', scd_type: 'SCD1', status: 'active', model_id: 2 },
  { id: 22, code: 'lonely', name: 'Einsam "quote"', scd_type: 'SCD1', status: 'active', model_id: 2 },
  { id: 23, code: 'tree', name: 'Baum', scd_type: 'SCD1', status: 'active', model_id: 2 },
  { id: 24, code: 'empty', name: 'Leer', scd_type: 'SCD1', status: 'draft', model_id: 2 },
]
const a = (over: Partial<AttributeRow> & Pick<AttributeRow, 'id' | 'entity_id' | 'code'>): AttributeRow => ({
  name: over.code, data_type: 'string', is_business_key: false, is_required: false, is_unique: false,
  sort_order: 0, reference_entity_id: null, cascade_parent_attribute: null, reference_display_attribute: null, ...over,
})
const attributes: AttributeRow[] = [
  a({ id: 1, entity_id: 10, code: 'name', is_business_key: true, sort_order: 10 }),
  a({ id: 2, entity_id: 10, code: 'class1', name: 'Hauptgruppe', data_type: 'reference', reference_entity_id: 20, sort_order: 20, is_required: true }),
  a({ id: 3, entity_id: 10, code: 'class2', name: 'Untergruppe', data_type: 'reference', reference_entity_id: 21, sort_order: 30, cascade_parent_attribute: 'class1' }),
  a({ id: 4, entity_id: 20, code: 'name', is_business_key: true }),
  a({ id: 5, entity_id: 21, code: 'name', is_business_key: true, sort_order: 10 }),
  a({ id: 6, entity_id: 21, code: 'level1', data_type: 'reference', reference_entity_id: 20, is_business_key: true, sort_order: 5 }),
  a({ id: 7, entity_id: 22, code: 'x', name: 'a "q" #amp; b' }),
  a({ id: 8, entity_id: 23, code: 'parent', data_type: 'reference', reference_entity_id: 23 }), // self reference
  a({ id: 9, entity_id: 10, code: '1st-col', sort_order: 40, is_unique: true }),
]

const graph = buildDesignerGraph({ models, entities, attributes })

test('graph: models sorted with stable colour index, entities ordered by model then name', () => {
  assert.deepEqual(graph.models.map(m => [m.code, m.colorIndex]), [['ASCEM', 0], ['EPD', 1]])
  assert.deepEqual(graph.entities.map(e => e.code), ['pool', 'tree', 'lonely', 'cat1', 'empty', 'cat2'])
})

test('graph: attributes are in form order (sort_order, then id)', () => {
  assert.deepEqual(graph.entities.find(e => e.code === 'cat2')!.attributes.map(x => x.code), ['level1', 'name'])
})

test('graph: one reference per reference attribute, with direction and flags', () => {
  assert.equal(graph.references.length, 4)
  const r = (id: number) => graph.references.find(x => x.id === id)!
  assert.deepEqual([r(2).fromEntityId, r(2).toEntityId, r(2).required, r(2).identifying, r(2).crossModel], [10, 20, true, false, true])
  assert.equal(r(3).required, false)
  assert.equal(r(3).cascadeParentCode, 'class1')
  assert.deepEqual([r(6).required, r(6).identifying, r(6).crossModel], [true, true, false]) // business key part is never empty
  assert.deepEqual([r(8).selfReference, r(8).crossModel], [true, false])
})

test('graph: dangling references and unknown models are reported, not drawn', () => {
  const g = buildDesignerGraph({
    models, entities: [...entities, { id: 99, code: 'orphan', name: 'O', scd_type: 'SCD1', status: 'draft', model_id: 77 }],
    attributes: [...attributes, a({ id: 50, entity_id: 10, code: 'gone', data_type: 'reference', reference_entity_id: 555 }), a({ id: 51, entity_id: 10, code: 'nowhere', data_type: 'reference' })],
  })
  assert.equal(g.references.length, 4)
  assert.equal(g.entities.some(e => e.code === 'orphan'), false)
  assert.equal(g.warnings.length, 3)
})

test('subgraph: model filter keeps foreign neighbours (cross-model references) unless disabled', () => {
  const asc = selectSubgraph(graph, { modelCodes: ['ASCEM'] })
  assert.deepEqual(asc.entities.map(e => e.code).sort(), ['cat1', 'cat2', 'pool'])
  assert.equal(asc.references.length, 3) // pool->cat1, pool->cat2, cat2->cat1 (both ends visible)
  const only = selectSubgraph(graph, { modelCodes: ['ASCEM'], includeForeignNeighbours: false })
  assert.deepEqual(only.entities.map(e => e.code), ['pool'])
  assert.equal(only.references.length, 0)
})

test('subgraph: focus + depth walks references in both directions', () => {
  assert.deepEqual(selectSubgraph(graph, { focusEntityId: 20, depth: 0 }).entities.map(e => e.code), ['cat1'])
  assert.deepEqual(selectSubgraph(graph, { focusEntityId: 20, depth: 1 }).entities.map(e => e.code).sort(), ['cat1', 'cat2', 'pool'])
  assert.deepEqual(selectSubgraph(graph, { focusEntityId: 22, depth: 3 }).entities.map(e => e.code), ['lonely'])
  assert.deepEqual([...entityNeighbours(graph, 21)].sort(), [10, 20])
})

test('subgraph: hiding isolated entities keeps the focus and ignores lone self references', () => {
  const view = selectSubgraph(graph, { showIsolated: false })
  assert.deepEqual(view.entities.map(e => e.code), ['pool', 'cat1', 'cat2'])
  assert.deepEqual(selectSubgraph(graph, { focusEntityId: 22, depth: 1, showIsolated: false }).entities.map(e => e.code), ['lonely'])
})

test('mermaid: header, layout and model classes', () => {
  const m = toMermaid(graph, { layout: 'elk' }).text
  assert.ok(m.startsWith('---\nconfig:\n  layout: elk\n---\nerDiagram\n  direction LR'))
  assert.ok(m.includes('classDef m1 fill:#2b4a6f,stroke:#4c90f0,color:#f6f7f9'))
  assert.ok(!toMermaid(graph, { layout: 'dagre' }).text.includes('layout: elk'))
  assert.ok(toMermaid(graph, { mode: 'light' }).text.includes('color:#1c2127'))
})

test('mermaid: entity blocks with keys, types, comments', () => {
  const m = toMermaid(graph).text
  assert.ok(m.includes('e10["ASCEM EPD POOL · ASCEM"]:::m1 {'))
  assert.ok(m.includes('    string name PK "name"'))
  assert.ok(m.includes('    ref class1 FK "Hauptgruppe *"')) // required marker
  assert.ok(m.includes('    ref level1 PK, FK "level1"'))
  assert.ok(m.includes('    string _1st_col UK "1st-col"')) // identifier-safe name
  assert.ok(m.includes('  e24["Leer · EPD"]:::m2\n')) // no attributes: no block
})

test('mermaid: relationship cardinality and line style', () => {
  const { text, references } = toMermaid(graph)
  assert.ok(text.includes('  e10 }o..|| e20 : "class1"')) // required, non-identifying
  assert.ok(text.includes('  e10 }o..o| e21 : "class2"')) // optional
  assert.ok(text.includes('  e21 }o--|| e20 : "level1"')) // identifying (business key part)
  assert.ok(text.includes('  e23 }o..o| e23 : "parent"')) // self reference
  assert.equal(references.length, 4)
  // relationship n in the text is references[n]: used to map a clicked line back
  const relLines = text.split('\n').filter(l => /^\s+e\d+ \}o/.test(l))
  relLines.forEach((line, i) => assert.ok(line.includes(`"${references[i].fromAttributeCode}"`)))
})

test('mermaid: text escaping', () => {
  assert.equal(mermaidLabel('a "q" #amp; b\nc'), "a 'q' amp b c")
  assert.equal(mermaidAttributeName('9x-y'), '_9x_y')
  const m = toMermaid(graph).text
  assert.ok(m.includes('e22["Einsam \'quote\' · EPD"]'))
  assert.ok(m.includes('"a \'q\' amp b"'))
})

test('mermaid: filtered graph never mentions entities that are not in it', () => {
  const sub = selectSubgraph(graph, { focusEntityId: 21, depth: 0 })
  const { text, references } = toMermaid(sub)
  assert.equal(references.length, 0)
  assert.ok(!/ e(10|20) /.test(text))
})
