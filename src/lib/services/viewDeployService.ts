import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

interface EntityView {
  id: number
  entity_id: number
  code: string
  name: string
  view_type: 'scd1' | 'scd2' | 'custom'
  custom_sql: string | null
  column_config: string | null
  filter_condition: string | null
}

interface Entity {
  id: number
  code: string
  name: string
}

interface Attribute {
  code: string
  name: string
  data_type: string
  precision: number | null
  scale: number | null
}

export interface ViewDeployResult {
  view_id: number
  code: string
  status: 'success' | 'failed'
  error?: string
}

export interface ViewDeployHooks {
  log?: (message: string) => void
  /** 0-100 */
  progress?: (percent: number) => void
}

// master/load tables store every attribute as NVARCHAR regardless of its
// declared data_type (see generate_models.py / mds_master DDL), so a view
// that just selects the column exposes text - and consumers (BI tools, the
// v1 API) have to cast it themselves. Expose the declared type instead.
// TRY_CAST, so a value that doesn't parse becomes NULL rather than failing
// the whole view; decimals additionally fall back through FLOAT so
// exponent notation ("1.2E-8"), which DECIMAL rejects, still converts.
export function typedColumnExpr(attr: Attribute, alias?: string): string {
  const col = `[${attr.code}]`
  const out = `[${alias || attr.code}]`

  switch (attr.data_type) {
    case 'integer':
      // INT (the project's own declared mapping for integer, see SQL_TYPE_MAP
      // in generate_models.py), not BIGINT: the mssql driver hands BIGINT back
      // as a string, which would undo the point of typing the column.
      return `TRY_CAST(COALESCE(TRY_CAST(${col} AS DECIMAL(38,10)), TRY_CAST(TRY_CAST(${col} AS FLOAT) AS DECIMAL(38,10))) AS INT) AS ${out}`
    case 'decimal': {
      const p = attr.precision && attr.scale !== null && attr.scale !== undefined ? attr.precision : 38
      const s = attr.precision && attr.scale !== null && attr.scale !== undefined ? attr.scale : 10
      return `COALESCE(TRY_CAST(${col} AS DECIMAL(${p},${s})), TRY_CAST(TRY_CAST(${col} AS FLOAT) AS DECIMAL(${p},${s}))) AS ${out}`
    }
    case 'boolean':
      return `TRY_CAST(${col} AS BIT) AS ${out}`
    case 'date':
      return `TRY_CAST(${col} AS DATE) AS ${out}`
    case 'datetime':
      return `TRY_CAST(${col} AS DATETIME2) AS ${out}`
    default:
      return alias && alias !== attr.code ? `${col} AS ${out}` : col
  }
}

async function generateViewSQL(
  view: EntityView,
  entity: Entity,
  sourceSchema: string,
  sourceTable: string
): Promise<string> {
  // For custom views, use the provided SQL wrapped in a view
  if (view.view_type === 'custom' && view.custom_sql) {
    return `CREATE VIEW mds_view.[${view.code}] AS
${view.custom_sql}`
  }

  const attributes = await dbQuery<Attribute>(
    `SELECT code, name, data_type, [precision], scale FROM mds_meta.attribute
     WHERE entity_id = @entityId ORDER BY sort_order`,
    { entityId: entity.id }
  )
  const attrByCode = new Map(attributes.map(a => [a.code, a]))

  let columns: string[]
  const defaultColumns = () => attributes.map(a => typedColumnExpr(a))
  if (view.column_config) {
    try {
      const config = JSON.parse(view.column_config)
      if (config.columns && Array.isArray(config.columns)) {
        // Custom column selection with optional transformations
        columns = config.columns.map((col: {
          code: string
          alias?: string
          transform?: string
        }) => {
          if (col.transform) {
            return `${col.transform} AS [${col.alias || col.code}]`
          }
          const attr = attrByCode.get(col.code)
          if (attr) return typedColumnExpr(attr, col.alias)
          return col.alias ? `[${col.code}] AS [${col.alias}]` : `[${col.code}]`
        })
      } else {
        columns = defaultColumns()
      }
    } catch {
      columns = defaultColumns()
    }
  } else {
    columns = defaultColumns()
  }

  // SCD2 views expose the full history including delete tombstones, so
  // is_deleted has to be visible or a deleted key just looks like a normal row.
  const metaColumns = sourceSchema === 'mds_master'
    ? (view.view_type === 'scd2'
        ? ['valid_from', 'valid_to', 'is_current', 'is_deleted']
        : ['valid_from', 'valid_to', 'is_current'])
    : ['load_timestamp', 'is_processed']

  let whereClause = ''

  if (view.view_type === 'scd1') {
    // Only current, non-deleted records - a DELETE produces a new
    // is_current=1 row (the tombstone, is_deleted=1) rather than removing
    // the old one, so is_current alone isn't enough to mean "still exists".
    if (sourceSchema === 'mds_master') {
      whereClause = 'WHERE is_current = 1 AND is_deleted = 0'
    } else {
      // For load table, get latest by business_key
      whereClause = `WHERE load_id IN (
        SELECT MAX(load_id) FROM ${sourceSchema}.[${sourceTable}] GROUP BY business_key
      )`
    }
  }
  // scd2 = no WHERE clause (all records)

  if (view.filter_condition) {
    if (whereClause) {
      whereClause += ` AND (${view.filter_condition})`
    } else {
      whereClause = `WHERE ${view.filter_condition}`
    }
  }

  const allColumns = [
    'business_key',
    'business_key_hash',
    ...columns,
    ...metaColumns
  ]

  return `CREATE VIEW mds_view.[${view.code}] AS
SELECT
    ${allColumns.join(',\n    ')}
FROM ${sourceSchema}.[${sourceTable}]
${whereClause}`
}

// Drops and recreates each given view from its current mds_meta definition,
// reporting each step through hooks.log so a caller can show a live log.
// Used by POST /api/views/deploy and by attribute changes that would
// otherwise leave a deployed view pointing at a dropped column.
export async function deployViews(
  viewIds: number[],
  user: string,
  hooks: ViewDeployHooks = {}
): Promise<ViewDeployResult[]> {
  const log = hooks.log ?? (() => {})
  const progress = hooks.progress ?? (() => {})
  const results: ViewDeployResult[] = []

  log(`📡 View-Deployment gestartet (${viewIds.length} View${viewIds.length === 1 ? '' : 's'}, Benutzer: ${user})`)

  await dbExecute(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'mds_view')
    BEGIN
      EXEC('CREATE SCHEMA mds_view')
    END
  `)

  for (let i = 0; i < viewIds.length; i++) {
    const viewId = viewIds[i]
    const prefix = `[${i + 1}/${viewIds.length}]`
    progress(Math.round((i / viewIds.length) * 100))

    try {
      const views = await dbQuery<EntityView>(
        `SELECT id, entity_id, code, name, view_type, custom_sql, column_config, filter_condition
         FROM mds_meta.entity_view WHERE id = @viewId`,
        { viewId }
      )

      if (views.length === 0) {
        log(`❌ ${prefix} View ${viewId} nicht gefunden`)
        results.push({ view_id: viewId, code: 'Unknown', status: 'failed', error: 'View not found' })
        continue
      }

      const view = views[0]
      log(`▶ ${prefix} ${view.code} (Typ: ${view.view_type})`)

      const entities = await dbQuery<Entity>(
        'SELECT id, code, name FROM mds_meta.entity WHERE id = @entityId',
        { entityId: view.entity_id }
      )
      if (entities.length === 0) {
        log(`❌ ${prefix} Entity ${view.entity_id} nicht gefunden`)
        results.push({ view_id: viewId, code: view.code, status: 'failed', error: 'Entity not found' })
        continue
      }
      const entity = entities[0]
      log(`   Entity: ${entity.name} (${entity.code})`)

      const sourceSchema = 'mds_master'
      const sourceTable = entity.code.toLowerCase()

      // Views MÜSSEN auf mds_master zeigen - kein Fallback auf mds_load
      const masterTableExists = await dbQuery<{ exists: number }>(
        `SELECT CASE WHEN EXISTS (
           SELECT 1 FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = 'mds_master' AND TABLE_NAME = @tableName
         ) THEN 1 ELSE 0 END AS [exists]`,
        { tableName: sourceTable }
      )
      if (masterTableExists[0].exists !== 1) {
        const error = `Master table mds_master.${sourceTable} does not exist. Run dbt first: dbt run --select mds_${sourceTable}`
        log(`❌ ${prefix} ${error}`)
        results.push({ view_id: viewId, code: view.code, status: 'failed', error })
        continue
      }
      log(`   ✓ Master-Tabelle mds_master.${sourceTable} gefunden`)

      const viewSql = await generateViewSQL(view, entity, sourceSchema, sourceTable)
      log('   ✓ SQL generiert:')
      viewSql.split('\n').forEach(line => log(`     ${line}`))

      await dbExecute(`DROP VIEW IF EXISTS mds_view.[${view.code}]`)
      log('   ✓ Bestehende View entfernt (falls vorhanden)')

      await dbExecute(viewSql)
      log('   ✓ View erstellt')

      await dbExecute(
        `UPDATE mds_meta.entity_view
         SET is_deployed = 1, last_deployed_at = GETUTCDATE(), updated_by = @user
         WHERE id = @viewId`,
        { viewId, user }
      )
      log(`✅ ${prefix} ${view.code} erfolgreich deployed`)

      results.push({ view_id: viewId, code: view.code, status: 'success' })
      logger.info({ viewCode: view.code }, 'View deployed successfully')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ error, viewId }, 'Failed to deploy view')
      log(`❌ ${prefix} Deployment fehlgeschlagen: ${message}`)
      results.push({ view_id: viewId, code: 'Unknown', status: 'failed', error: message })
    }
  }

  progress(100)
  const ok = results.filter(r => r.status === 'success').length
  log(ok === results.length
    ? `🏁 Fertig: ${ok} von ${results.length} View(s) erfolgreich deployed`
    : `⚠️ Fertig: ${ok} von ${results.length} View(s) erfolgreich deployed, ${results.length - ok} fehlgeschlagen`)

  return results
}

// Redeploys every currently-deployed, active view of an entity. Used after a
// schema change (e.g. an attribute was deleted) that would otherwise leave
// the live view referencing a column that no longer exists.
export async function redeployViewsForEntity(
  entityId: number,
  user: string,
  hooks: ViewDeployHooks = {}
): Promise<ViewDeployResult[]> {
  const views = await dbQuery<{ id: number }>(
    'SELECT id FROM mds_meta.entity_view WHERE entity_id = @entityId AND is_deployed = 1 AND is_active = 1',
    { entityId }
  )
  if (views.length === 0) return []
  return deployViews(views.map(v => v.id), user, hooks)
}
