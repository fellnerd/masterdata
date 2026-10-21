import { dbQuery } from '@/lib/db-server'

// Configuration of a reference attribute beyond "points at entity X":
//
//   reference_value_attribute    which attribute of the referenced entity is
//                                STORED as the value (null = its business key)
//   reference_display_attribute  which attribute is SHOWN in the dropdown
//                                (null = same as the value)
//   cascade_parent_attribute     attribute of THIS entity whose current value
//   cascade_filter_attribute     narrows the dropdown to referenced records
//                                whose <filter attribute> equals that value
//
// The cascade pair is what makes "pick a Hauptgruppe, then only see its
// Untergruppen" work: Untergruppe is a reference to the Untergruppen entity,
// parent = the Hauptgruppe attribute of this entity, filter = the Hauptgruppe
// attribute of the Untergruppen entity.

export interface ReferenceConfig {
  data_type: string
  reference_entity_id: number | null
  reference_value_attribute: string | null
  reference_display_attribute: string | null
  cascade_parent_attribute: string | null
  cascade_filter_attribute: string | null
}

interface AttrRow {
  code: string
  data_type: string
  is_business_key: boolean
  is_unique: boolean
  reference_entity_id: number | null
  reference_value_attribute: string | null
  cascade_parent_attribute: string | null
}

const norm = (v: string | null | undefined) => (v === undefined || v === null || v.trim() === '' ? null : v.trim())

export function normalizeReferenceConfig(cfg: ReferenceConfig): ReferenceConfig {
  return {
    ...cfg,
    reference_value_attribute: norm(cfg.reference_value_attribute),
    reference_display_attribute: norm(cfg.reference_display_attribute),
    cascade_parent_attribute: norm(cfg.cascade_parent_attribute),
    cascade_filter_attribute: norm(cfg.cascade_filter_attribute),
  }
}

async function loadAttributes(entityId: number): Promise<AttrRow[]> {
  return dbQuery<AttrRow>(
    `SELECT code, data_type, is_business_key, is_unique, reference_entity_id,
            reference_value_attribute, cascade_parent_attribute
     FROM mds_meta.attribute WHERE entity_id = @entityId`,
    { entityId }
  )
}

// Returns an error message, or null if the configuration is consistent.
// `selfCode` is the attribute being created/updated (its own row may not exist
// yet, or still hold old values - the config under test is passed in `cfg`).
export async function validateReferenceConfig(
  entityId: number,
  selfCode: string,
  rawCfg: ReferenceConfig
): Promise<string | null> {
  const cfg = normalizeReferenceConfig(rawCfg)
  const hasExtras = !!(cfg.reference_value_attribute || cfg.reference_display_attribute ||
    cfg.cascade_parent_attribute || cfg.cascade_filter_attribute)

  if (cfg.data_type !== 'reference') {
    return hasExtras
      ? 'reference_value_attribute, reference_display_attribute and cascade_* only apply to attributes of data_type "reference"'
      : null
  }
  if (!hasExtras) return null
  if (!cfg.reference_entity_id) {
    return 'reference_entity_id is required to configure the reference value/display/cascade attributes'
  }

  const refAttrs = await loadAttributes(cfg.reference_entity_id)
  const refByCode = new Map(refAttrs.map(a => [a.code, a]))

  if (cfg.reference_value_attribute) {
    const a = refByCode.get(cfg.reference_value_attribute)
    if (!a) return `reference_value_attribute "${cfg.reference_value_attribute}" is not an attribute of the referenced entity`
    const bkCount = refAttrs.filter(x => x.is_business_key).length
    const identifies = a.is_unique || (a.is_business_key && bkCount === 1)
    if (!identifies) {
      return `reference_value_attribute "${a.code}" must identify a record uniquely - it needs the Unique flag, or be the referenced entity's only business key ` +
        '(otherwise one stored value could mean several records)'
    }
  }

  if (cfg.reference_display_attribute && !refByCode.has(cfg.reference_display_attribute)) {
    return `reference_display_attribute "${cfg.reference_display_attribute}" is not an attribute of the referenced entity`
  }

  if (!!cfg.cascade_parent_attribute !== !!cfg.cascade_filter_attribute) {
    return 'cascade_parent_attribute and cascade_filter_attribute must be set together (or both left empty)'
  }

  if (cfg.cascade_parent_attribute && cfg.cascade_filter_attribute) {
    if (cfg.cascade_parent_attribute === selfCode) {
      return 'cascade_parent_attribute cannot be the attribute itself'
    }
    const own = await loadAttributes(entityId)
    const ownByCode = new Map(own.map(a => [a.code, a]))
    const parent = ownByCode.get(cfg.cascade_parent_attribute)
    if (!parent) return `cascade_parent_attribute "${cfg.cascade_parent_attribute}" is not an attribute of this entity`

    const filter = refByCode.get(cfg.cascade_filter_attribute)
    if (!filter) return `cascade_filter_attribute "${cfg.cascade_filter_attribute}" is not an attribute of the referenced entity`

    // Both sides are compared as stored text, so two references only match if
    // they point at the same entity and store the same field of it.
    if (parent.data_type === 'reference' && filter.data_type === 'reference') {
      if (parent.reference_entity_id !== filter.reference_entity_id) {
        return `Parent "${parent.code}" and filter "${filter.code}" reference different entities, so their values can never match`
      }
      if ((parent.reference_value_attribute ?? null) !== (filter.reference_value_attribute ?? null)) {
        return `Parent "${parent.code}" and filter "${filter.code}" store different fields of the referenced entity, so their values can never match`
      }
    }

    // A chain of cascades must not loop back to this attribute.
    const seen = new Set<string>([selfCode])
    let cursor: string | null = parent.code
    while (cursor) {
      if (seen.has(cursor)) return 'Cascade configuration would form a loop (an attribute would depend on itself)'
      seen.add(cursor)
      cursor = ownByCode.get(cursor)?.cascade_parent_attribute ?? null
    }
  }

  return null
}

// What stops an attribute from being deleted (it is the STORED value field of
// another reference attribute - deleting it would silently change what that
// attribute means), plus the dependents whose display/cascade config just
// needs clearing. Returns the blocking message or null.
export async function findValueAttributeUsage(entityId: number, attrCode: string): Promise<string | null> {
  const rows = await dbQuery<{ entity_code: string; code: string }>(
    `SELECT e.code AS entity_code, a.code
     FROM mds_meta.attribute a
     JOIN mds_meta.entity e ON e.id = a.entity_id
     WHERE a.reference_entity_id = @entityId AND a.reference_value_attribute = @attrCode`,
    { entityId, attrCode }
  )
  if (rows.length === 0) return null
  return `Attribute "${attrCode}" is used as the stored value field of ${rows.map(r => `${r.entity_code}.${r.code}`).join(', ')} - change those first`
}
