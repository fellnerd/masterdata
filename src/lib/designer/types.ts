// Designer: an ER view of the metadata (models, entities, attributes and the
// references between them). Everything here is derived from mds_meta - there is
// no stored diagram - so the diagram can never drift from the model.

export interface DesignerModel {
  id: number
  code: string
  name: string
  status: string
  /** Stable position of the model in the sorted model list - drives its colour. */
  colorIndex: number
}

export interface DesignerAttribute {
  id: number
  code: string
  name: string
  dataType: string
  isBusinessKey: boolean
  isRequired: boolean
  isUnique: boolean
  sortOrder: number
  referenceEntityId: number | null
  /** Cascade: code of the attribute of the same entity this one depends on. */
  cascadeParentCode: string | null
  /** Attribute of the referenced entity shown in dropdowns instead of the business key. */
  displayAttributeCode: string | null
}

export interface DesignerEntity {
  id: number
  code: string
  name: string
  modelId: number
  modelCode: string
  modelName: string
  scdType: string
  status: string
  attributes: DesignerAttribute[]
}

export interface DesignerReference {
  /** The referencing attribute's id - unique per reference. */
  id: number
  fromEntityId: number
  fromAttributeId: number
  fromAttributeCode: string
  toEntityId: number
  /** Required attribute = every record must point at a parent (1), else optional (0..1). */
  required: boolean
  /** The referencing attribute is (part of) the business key: an identifying relationship. */
  identifying: boolean
  selfReference: boolean
  crossModel: boolean
  cascadeParentCode: string | null
}

export interface DesignerGraph {
  models: DesignerModel[]
  entities: DesignerEntity[]
  references: DesignerReference[]
  /** Metadata inconsistencies that were skipped (e.g. a reference to a deleted entity). */
  warnings: string[]
}

// Flat rows as they come out of mds_meta (see loadGraph.ts).
export interface ModelRow { id: number; code: string; name: string; status: string }
export interface EntityRow { id: number; code: string; name: string; scd_type: string; status: string; model_id: number }
export interface AttributeRow {
  id: number
  entity_id: number
  code: string
  name: string
  data_type: string
  is_business_key: boolean | number
  is_required: boolean | number
  is_unique: boolean | number
  sort_order: number
  reference_entity_id: number | null
  cascade_parent_attribute: string | null
  reference_display_attribute: string | null
}
