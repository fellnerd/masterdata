import type {
  AttributeRow, DesignerAttribute, DesignerEntity, DesignerGraph, DesignerReference, EntityRow, ModelRow,
} from './types'

// Turns the flat metadata rows into the diagram graph. Pure (no database), so
// it is unit-tested against fixtures and the same function runs on the server
// (GET /api/designer/graph) and in tests.
export function buildDesignerGraph(input: {
  models: ModelRow[]
  entities: EntityRow[]
  attributes: AttributeRow[]
}): DesignerGraph {
  const warnings: string[] = []

  const models = [...input.models]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((m, i) => ({ id: m.id, code: m.code, name: m.name, status: m.status, colorIndex: i }))
  const modelById = new Map(models.map(m => [m.id, m]))

  const attrsByEntity = new Map<number, AttributeRow[]>()
  for (const a of input.attributes) {
    const list = attrsByEntity.get(a.entity_id) ?? []
    list.push(a)
    attrsByEntity.set(a.entity_id, list)
  }

  const entities: DesignerEntity[] = []
  for (const e of input.entities) {
    const model = modelById.get(e.model_id)
    if (!model) {
      warnings.push(`Entity ${e.code} (id ${e.id}) belongs to unknown model ${e.model_id} and is left out`)
      continue
    }
    const attributes: DesignerAttribute[] = (attrsByEntity.get(e.id) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) // same tie-break as forms / key derivation
      .map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        dataType: a.data_type,
        isBusinessKey: !!a.is_business_key,
        isRequired: !!a.is_required,
        isUnique: !!a.is_unique,
        sortOrder: a.sort_order,
        referenceEntityId: a.data_type === 'reference' ? a.reference_entity_id : null,
        cascadeParentCode: a.cascade_parent_attribute,
        displayAttributeCode: a.reference_display_attribute,
      }))
    entities.push({
      id: e.id, code: e.code, name: e.name,
      modelId: model.id, modelCode: model.code, modelName: model.name,
      scdType: e.scd_type, status: e.status, attributes,
    })
  }
  entities.sort((a, b) => a.modelCode.localeCompare(b.modelCode) || a.name.localeCompare(b.name) || a.id - b.id)

  const entityById = new Map(entities.map(e => [e.id, e]))
  const references: DesignerReference[] = []
  for (const e of entities) {
    for (const a of e.attributes) {
      if (a.referenceEntityId === null) {
        if (a.dataType === 'reference') warnings.push(`Attribute ${e.code}.${a.code} is a reference without a target entity`)
        continue
      }
      const target = entityById.get(a.referenceEntityId)
      if (!target) {
        warnings.push(`Attribute ${e.code}.${a.code} references unknown entity ${a.referenceEntityId}; no relationship drawn`)
        continue
      }
      references.push({
        id: a.id,
        fromEntityId: e.id,
        fromAttributeId: a.id,
        fromAttributeCode: a.code,
        toEntityId: target.id,
        required: a.isRequired || a.isBusinessKey, // a business-key part can never be empty
        identifying: a.isBusinessKey,
        selfReference: target.id === e.id,
        crossModel: target.modelId !== e.modelId,
        cascadeParentCode: a.cascadeParentCode,
      })
    }
  }

  return { models, entities, references, warnings }
}

export interface SubgraphOptions {
  /** Model codes to show; undefined/empty = all. */
  modelCodes?: string[]
  /** With a model filter: also show entities of other models that the shown entities reference or are referenced by. */
  includeForeignNeighbours?: boolean
  /** Show only this entity and everything within `depth` reference steps (either direction). Overrides the model filter. */
  focusEntityId?: number | null
  depth?: number
  /**
   * false = drop entities that have no relationship to another entity left in the view (a lone self-reference
   * does not count; the focus entity always stays).
   */
  showIsolated?: boolean
}

export function entityNeighbours(graph: DesignerGraph, entityId: number): Set<number> {
  const out = new Set<number>()
  for (const r of graph.references) {
    if (r.fromEntityId === entityId) out.add(r.toEntityId)
    if (r.toEntityId === entityId) out.add(r.fromEntityId)
  }
  out.delete(entityId)
  return out
}

export function selectSubgraph(graph: DesignerGraph, opts: SubgraphOptions = {}): DesignerGraph {
  const { modelCodes, includeForeignNeighbours = true, focusEntityId = null, depth = 1, showIsolated = true } = opts
  let visible: Set<number>

  if (focusEntityId !== null && graph.entities.some(e => e.id === focusEntityId)) {
    visible = new Set([focusEntityId])
    let frontier = [focusEntityId]
    for (let step = 0; step < Math.max(0, depth); step++) {
      const next: number[] = []
      for (const id of frontier) {
        for (const n of entityNeighbours(graph, id)) {
          if (!visible.has(n)) { visible.add(n); next.push(n) }
        }
      }
      frontier = next
    }
  } else if (modelCodes && modelCodes.length > 0) {
    const wanted = new Set(modelCodes)
    visible = new Set(graph.entities.filter(e => wanted.has(e.modelCode)).map(e => e.id))
    if (includeForeignNeighbours) {
      for (const id of [...visible]) for (const n of entityNeighbours(graph, id)) visible.add(n)
    }
  } else {
    visible = new Set(graph.entities.map(e => e.id))
  }

  let references = graph.references.filter(r => visible.has(r.fromEntityId) && visible.has(r.toEntityId))

  if (!showIsolated) {
    const keep = new Set<number>()
    for (const id of visible) {
      if (id === focusEntityId || referencesOf(references, id).some(r => !r.selfReference)) keep.add(id)
    }
    visible = keep
    references = references.filter(r => visible.has(r.fromEntityId) && visible.has(r.toEntityId))
  }

  return {
    ...graph,
    entities: graph.entities.filter(e => visible.has(e.id)),
    references,
  }
}

function referencesOf(refs: DesignerReference[], entityId: number): DesignerReference[] {
  return refs.filter(r => r.fromEntityId === entityId || r.toEntityId === entityId)
}
