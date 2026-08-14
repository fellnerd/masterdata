import { dbQuery } from '@/lib/db-server'

// Enforces that reference-type attribute values point at a business_key that
// actually exists in the referenced entity's staged records - the same
// "pick from the list only" rule the UI's reference picker enforces, applied
// here too so it can't be bypassed via direct API/token calls.
export async function validateReferenceAttributes(
  entityId: number,
  data: Record<string, unknown>
): Promise<string | null> {
  const referenceAttrs = await dbQuery<{ code: string; name: string; reference_entity_id: number; reference_entity_code: string }>(
    `SELECT a.code, a.name, a.reference_entity_id, re.code AS reference_entity_code
     FROM mds_meta.attribute a
     JOIN mds_meta.entity re ON re.id = a.reference_entity_id
     WHERE a.entity_id = @entityId AND a.data_type = 'reference' AND a.reference_entity_id IS NOT NULL`,
    { entityId }
  )

  for (const attr of referenceAttrs) {
    const value = data[attr.code]
    if (value === undefined || value === null || value === '') continue

    const match = await dbQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM mds_stage.staged_record WHERE entity_id = @refEntityId AND business_key = @value`,
      { refEntityId: attr.reference_entity_id, value: String(value) }
    )

    if (match[0].cnt === 0) {
      return `Attribute '${attr.name}' references '${value}', but no record with that business key exists in '${attr.reference_entity_code}'`
    }
  }

  return null
}
