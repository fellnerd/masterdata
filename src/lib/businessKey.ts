import { dbQuery } from '@/lib/db-server'

// Business-key attribute codes for an entity, in sort_order - the same
// order import_from_datavault.sql uses when building a composite key from
// multiple business-key attributes, so a manually-created record's key and
// an imported one are built the same way.
export async function getBusinessKeyAttributeCodes(entityId: number): Promise<string[]> {
  const rows = await dbQuery<{ code: string }>(
    'SELECT code FROM mds_meta.attribute WHERE entity_id = @entityId AND is_business_key = 1 ORDER BY sort_order',
    { entityId }
  )
  return rows.map(r => r.code)
}

// Derives a record's business_key from `data`, mirroring
// import_from_datavault.sql's bk_concat: one attribute's value used as-is,
// several joined with '|'. Unlike the import macro (which substitutes an
// empty string for a NULL source column, since a bulk import can't stop to
// ask), this returns undefined if ANY business-key component is missing -
// manual entry should reject a partial composite key outright rather than
// silently stage a degenerate one like "value1|".
export function deriveBusinessKey(bkCodes: string[], data: Record<string, unknown>): string | undefined {
  if (bkCodes.length === 0) return undefined
  const values = bkCodes.map(code => data[code])
  // Falsy-but-valid values (0, false) must not be treated as missing.
  if (values.some(v => v === undefined || v === null || v === '')) return undefined
  return values.map(v => String(v)).join('|')
}
