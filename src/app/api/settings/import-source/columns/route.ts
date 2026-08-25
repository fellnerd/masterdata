import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/settings/import-source/columns?object=schema.table - Live column
// list for one Data Vault object, read directly from INFORMATION_SCHEMA -
// the same ground truth dbt's import_from_datavault macro checks an
// attribute's (possibly auto-by-code) mapping against at import time (see
// real_columns_query there). The Import Configuration dialog uses this to
// warn when a mapping won't actually resolve, instead of relying solely on
// the static SQL-file parser used to list available objects (config-parser.ts),
// which is a best-effort guess and can still miss or mis-name a column.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const object = searchParams.get('object')
  if (!object) {
    return NextResponse.json({ error: 'object query param is required (schema.table)' }, { status: 400 })
  }

  const dotIndex = object.indexOf('.')
  if (dotIndex < 1 || dotIndex === object.length - 1) {
    return NextResponse.json({ error: 'object must be in the form schema.table' }, { status: 400 })
  }
  const schema = object.slice(0, dotIndex)
  const table = object.slice(dotIndex + 1)

  try {
    const rows = await dbQuery<{ column_name: string }>(
      `SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
       ORDER BY ORDINAL_POSITION`,
      { schema, table }
    )
    return NextResponse.json({ columns: rows.map(r => r.column_name) })
  } catch (error) {
    logger.error({ error, object }, 'Failed to fetch live columns for import object')
    return NextResponse.json({ error: 'Failed to fetch columns' }, { status: 500 })
  }
}
