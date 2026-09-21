// mds_master/mds_load (and the JSON blob of a staged record) store every
// attribute as text regardless of its declared data_type, so anything that
// wants typed values in SQL - the generated views, and ?distinct= on the read
// API - has to cast. One place, so a view column and a distinct value list
// agree on what "an integer" or "a decimal" means.
//
// TRY_CAST, so a value that doesn't parse becomes NULL rather than failing the
// whole statement; decimals additionally fall back through FLOAT so exponent
// notation ("1.2E-8"), which DECIMAL rejects, still converts.
//
// Blank text (empty or whitespace-only) is NULL, not a value: SQL Server's
// TRY_CAST('' AS INT) is 0 and TRY_CAST('' AS DATE) is 1900-01-01, which would
// turn every empty cell into a bogus 0 / date in a view or a dropdown list.
export function typedValueExpr(
  dataType: string,
  raw: string,
  precision?: number | null,
  scale?: number | null
): string {
  const text = `NULLIF(LTRIM(RTRIM(${raw})), '')`

  switch (dataType) {
    case 'integer':
      // INT (the project's own declared mapping for integer, see SQL_TYPE_MAP
      // in generate_models.py), not BIGINT: the mssql driver hands BIGINT back
      // as a string, which would undo the point of typing the column.
      return `TRY_CAST(COALESCE(TRY_CAST(${text} AS DECIMAL(38,10)), TRY_CAST(TRY_CAST(${text} AS FLOAT) AS DECIMAL(38,10))) AS INT)`
    case 'decimal': {
      const declared = !!precision && scale !== null && scale !== undefined
      const p = declared ? precision : 38
      const s = declared ? scale : 10
      return `COALESCE(TRY_CAST(${text} AS DECIMAL(${p},${s})), TRY_CAST(TRY_CAST(${text} AS FLOAT) AS DECIMAL(${p},${s})))`
    }
    case 'boolean':
      return `TRY_CAST(${text} AS BIT)`
    case 'date':
      return `TRY_CAST(${text} AS DATE)`
    case 'datetime':
      return `TRY_CAST(${text} AS DATETIME2)`
    default:
      return raw
  }
}
