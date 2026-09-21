// mds_master (and mds_load) store every attribute as NVARCHAR regardless of
// its declared data_type, so GET /api/v1/master/... used to return numbers and
// booleans as JSON strings ("total_records":"8"). Convert them back to the
// declared type on the way out - the declared type lives in mds_meta.attribute.
//
// Conversion is conservative: a value that doesn't parse as its declared type
// is returned untouched rather than nulled out or guessed at. The literal text
// 'null' is turned into a real null for non-string types only - the Data Vault
// import used to write missing source values as that 4-character string (see
// import_from_datavault.sql), which can never be a legitimate number/boolean/
// date, but could in principle be a real string value, so string attributes
// are left as stored.

export function coerceRowByAttributeTypes(
  row: Record<string, unknown>,
  typeByCode: Map<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }

  for (const [code, dataType] of typeByCode) {
    const key = Object.keys(out).find(k => k.toLowerCase() === code.toLowerCase())
    if (key === undefined) continue
    const value = out[key]
    if (typeof value !== 'string') continue

    switch (dataType) {
      case 'integer':
      case 'decimal': {
        if (value === 'null') { out[key] = null; break }
        const trimmed = value.trim()
        const num = Number(trimmed)
        if (trimmed !== '' && Number.isFinite(num)) {
          out[key] = dataType === 'integer' && !Number.isInteger(num) ? value : num
        }
        break
      }
      case 'boolean': {
        const v = value.trim().toLowerCase()
        if (v === 'null') out[key] = null
        else if (v === 'true' || v === '1') out[key] = true
        else if (v === 'false' || v === '0') out[key] = false
        break
      }
      case 'date':
      case 'datetime':
        if (value === 'null') out[key] = null
        break
    }
  }

  return out
}
