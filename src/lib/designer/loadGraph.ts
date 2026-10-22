import { dbQuery } from '@/lib/db-server'
import { buildDesignerGraph } from './graph'
import { entityAllowed, modelAllowed, type Visibility } from '@/lib/permissions/core'
import type { AttributeRow, DesignerGraph, EntityRow, ModelRow } from './types'

// Reads the whole model metadata (three small queries - a few dozen entities)
// and builds the diagram graph from it.
//
// With a `visibility`, only the models/entities the caller may read go into the
// graph; a reference to an entity they cannot see is dropped (its attribute stays,
// so the table is complete, but there is no line to the hidden entity).
export async function loadDesignerGraph(visibility?: Visibility): Promise<DesignerGraph> {
  const [models, entities, attributes] = await Promise.all([
    dbQuery<ModelRow>('SELECT id, code, name, status FROM mds_meta.model'),
    dbQuery<EntityRow>('SELECT id, code, name, scd_type, status, model_id FROM mds_meta.entity'),
    dbQuery<AttributeRow>(
      `SELECT id, entity_id, code, name, data_type, is_business_key, is_required, is_unique, sort_order,
              reference_entity_id, cascade_parent_attribute, reference_display_attribute
       FROM mds_meta.attribute`
    ),
  ])
  if (!visibility || visibility.all) return buildDesignerGraph({ models, entities, attributes })

  const visibleEntities = entities.filter(e => entityAllowed(visibility, e.id))
  const visibleIds = new Set(visibleEntities.map(e => e.id))
  return buildDesignerGraph({
    models: models.filter(m => modelAllowed(visibility, m.id)),
    entities: visibleEntities,
    attributes: attributes
      .filter(a => visibleIds.has(a.entity_id))
      .map(a => (a.reference_entity_id != null && !visibleIds.has(a.reference_entity_id) ? { ...a, reference_entity_id: null } : a)),
  })
}
