import { dbQuery } from '@/lib/db-server'

// Enforces that reference-type attribute values point at a record that
// actually exists in the referenced entity's staged records - the same
// "pick from the list only" rule the UI's reference picker enforces, applied
// here too so it can't be bypassed via direct API/token calls.
//
// "Points at" is, by default, the referenced record's business key; an
// attribute can instead store another (unique) attribute of the referenced
// entity (reference_value_attribute). And when the attribute is the child of a
// cascade (cascade_parent_attribute / cascade_filter_attribute) the picked
// record must also belong to the currently selected parent value - so a
// Untergruppe that doesn't belong to the chosen Hauptgruppe is rejected here
// as well, not just hidden in the dropdown.

const IDENT_RE = /^[a-zA-Z0-9_]+$/

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

export async function validateReferenceAttributes(
  entityId: number,
  data: Record<string, unknown>
): Promise<string | null> {
  const referenceAttrs = await dbQuery<{
    code: string
    name: string
    reference_entity_id: number
    reference_entity_code: string
    reference_value_attribute: string | null
    cascade_parent_attribute: string | null
    cascade_filter_attribute: string | null
  }>(
    `SELECT a.code, a.name, a.reference_entity_id, re.code AS reference_entity_code,
            a.reference_value_attribute, a.cascade_parent_attribute, a.cascade_filter_attribute
     FROM mds_meta.attribute a
     JOIN mds_meta.entity re ON re.id = a.reference_entity_id
     WHERE a.entity_id = @entityId AND a.data_type = 'reference' AND a.reference_entity_id IS NOT NULL`,
    { entityId }
  )

  const nameByCode = new Map<string, string>()
  if (referenceAttrs.some(a => a.cascade_parent_attribute)) {
    const all = await dbQuery<{ code: string; name: string }>(
      'SELECT code, name FROM mds_meta.attribute WHERE entity_id = @entityId',
      { entityId }
    )
    all.forEach(a => nameByCode.set(a.code, a.name))
  }

  for (const attr of referenceAttrs) {
    const value = data[attr.code]
    if (isBlank(value)) continue

    // Column names are interpolated into a JSON path, so only ever from the
    // trusted metadata and only if they look like identifiers.
    const valueAttr = attr.reference_value_attribute
    const filterAttr = attr.cascade_filter_attribute
    if ((valueAttr && !IDENT_RE.test(valueAttr)) || (filterAttr && !IDENT_RE.test(filterAttr))) {
      return `Attribute '${attr.name}' has an invalid reference configuration`
    }

    const valueExpr = valueAttr ? `JSON_VALUE(data, '$.${valueAttr}')` : 'business_key'
    const base = `SELECT COUNT(*) AS cnt FROM mds_stage.staged_record WHERE entity_id = @refEntityId AND ${valueExpr} = @value`
    const baseParams = { refEntityId: attr.reference_entity_id, value: String(value) }

    const parentValue = attr.cascade_parent_attribute ? data[attr.cascade_parent_attribute] : undefined
    const cascadeActive = !!(attr.cascade_parent_attribute && filterAttr && !isBlank(parentValue))

    if (cascadeActive) {
      const match = await dbQuery<{ cnt: number }>(
        `${base} AND JSON_VALUE(data, '$.${filterAttr}') = @parentValue`,
        { ...baseParams, parentValue: String(parentValue) }
      )
      if (match[0].cnt > 0) continue

      const anywhere = await dbQuery<{ cnt: number }>(base, baseParams)
      if (anywhere[0].cnt > 0) {
        const parentName = nameByCode.get(attr.cascade_parent_attribute!) ?? attr.cascade_parent_attribute
        return `Attribute '${attr.name}': '${value}' does not belong to the selected ${parentName} '${parentValue}'`
      }
    } else {
      const match = await dbQuery<{ cnt: number }>(base, baseParams)
      if (match[0].cnt > 0) continue
    }

    return valueAttr
      ? `Attribute '${attr.name}' references '${value}', but no record with ${valueAttr} '${value}' exists in '${attr.reference_entity_code}'`
      : `Attribute '${attr.name}' references '${value}', but no record with that business key exists in '${attr.reference_entity_code}'`
  }

  return null
}
