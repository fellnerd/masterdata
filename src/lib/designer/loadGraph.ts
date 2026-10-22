import { dbQuery } from '@/lib/db-server'
import { buildDesignerGraph } from './graph'
import type { AttributeRow, DesignerGraph, EntityRow, ModelRow } from './types'

// Reads the whole model metadata (three small queries - a few dozen entities)
// and builds the diagram graph from it.
export async function loadDesignerGraph(): Promise<DesignerGraph> {
  const [models, entities, attributes] = await Promise.all([
    dbQuery<ModelRow>('SELECT id, code, name, status FROM mds_meta.model'),
    dbQuery<EntityRow>('SELECT id, code, name, scd_type, status, model_id FROM mds_meta.entity'),
    dbQuery<AttributeRow>(
      `SELECT id, entity_id, code, name, data_type, is_business_key, is_required, is_unique, sort_order,
              reference_entity_id, cascade_parent_attribute, reference_display_attribute
       FROM mds_meta.attribute`
    ),
  ])
  return buildDesignerGraph({ models, entities, attributes })
}
