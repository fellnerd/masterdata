import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Deploy Views API
 * 
 * Generates and deploys SQL views based on view configuration.
 * Views are created in mds_view schema.
 */

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
}

// POST /api/views/deploy - Deploy one or more views
export async function POST(request: NextRequest) {
  logger.info('POST /api/views/deploy')
  
  try {
    const body = await request.json()
    const { view_ids, user = 'admin' } = body
    
    if (!view_ids || !Array.isArray(view_ids) || view_ids.length === 0) {
      return NextResponse.json(
        { error: 'view_ids array is required' },
        { status: 400 }
      )
    }
    
    // Ensure mds_view schema exists
    await dbExecute(`
      IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'mds_view')
      BEGIN
        EXEC('CREATE SCHEMA mds_view')
      END
    `)
    
    const results: Array<{
      view_id: number
      code: string
      status: 'success' | 'failed'
      error?: string
    }> = []
    
    for (const viewId of view_ids) {
      try {
        // Get view configuration
        const views = await dbQuery<EntityView>(
          `SELECT id, entity_id, code, name, view_type, custom_sql, column_config, filter_condition
           FROM mds_meta.entity_view WHERE id = @viewId`,
          { viewId }
        )
        
        if (views.length === 0) {
          results.push({
            view_id: viewId,
            code: 'Unknown',
            status: 'failed',
            error: 'View not found'
          })
          continue
        }
        
        const view = views[0]
        
        // Get entity details
        const entities = await dbQuery<Entity>(
          'SELECT id, code, name FROM mds_meta.entity WHERE id = @entityId',
          { entityId: view.entity_id }
        )
        
        if (entities.length === 0) {
          results.push({
            view_id: viewId,
            code: view.code,
            status: 'failed',
            error: 'Entity not found'
          })
          continue
        }
        
        const entity = entities[0]
        
        // Check if master table exists - Views MÜSSEN auf mds_master zeigen
        const masterTableExists = await dbQuery<{ exists: number }>(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM INFORMATION_SCHEMA.TABLES 
             WHERE TABLE_SCHEMA = 'mds_master' AND TABLE_NAME = @tableName
           ) THEN 1 ELSE 0 END AS [exists]`,
          { tableName: entity.code.toLowerCase() }
        )
        
        // Master table MUSS existieren - kein Fallback auf mds_load
        if (masterTableExists[0].exists !== 1) {
          results.push({
            view_id: viewId,
            code: view.code,
            status: 'failed',
            error: `Master table mds_master.${entity.code.toLowerCase()} does not exist. Run dbt first: dbt run --select mds_${entity.code.toLowerCase()}`
          })
          continue
        }
        
        const sourceSchema = 'mds_master'
        const sourceTable = entity.code.toLowerCase()
        
        // Generate view SQL
        const viewSql = await generateViewSQL(view, entity, sourceSchema, sourceTable)
        
        logger.info({ viewCode: view.code, sql: viewSql }, 'Deploying view')
        
        // Drop existing view if exists
        await dbExecute(`DROP VIEW IF EXISTS mds_view.[${view.code}]`)
        
        // Create view
        await dbExecute(viewSql)
        
        // Update view config
        await dbExecute(
          `UPDATE mds_meta.entity_view 
           SET is_deployed = 1, last_deployed_at = GETUTCDATE(), updated_by = @user
           WHERE id = @viewId`,
          { viewId, user }
        )
        
        results.push({
          view_id: viewId,
          code: view.code,
          status: 'success'
        })
        
        logger.info({ viewCode: view.code }, 'View deployed successfully')
        
      } catch (error) {
        logger.error({ error, viewId }, 'Failed to deploy view')
        results.push({
          view_id: viewId,
          code: 'Unknown',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length
    
    return NextResponse.json({
      views_processed: results.length,
      views_success: successCount,
      views_failed: results.length - successCount,
      results,
      message: successCount === results.length
        ? 'All views deployed successfully'
        : `${successCount} of ${results.length} views deployed successfully`
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to deploy views')
    return NextResponse.json(
      { error: 'Failed to deploy views' },
      { status: 500 }
    )
  }
}

/**
 * Generate SQL for creating a view based on configuration
 */
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
  
  // Get entity attributes for column selection
  const attributes = await dbQuery<Attribute>(
    `SELECT code, name, data_type FROM mds_meta.attribute 
     WHERE entity_id = @entityId ORDER BY sort_order`,
    { entityId: entity.id }
  )
  
  // Parse column config if provided
  let columns: string[]
  if (view.column_config) {
    try {
      const config = JSON.parse(view.column_config)
      if (config.columns && Array.isArray(config.columns)) {
        // Custom column selection with optional transformations
        columns = config.columns.map((col: { 
          code: string; 
          alias?: string; 
          transform?: string 
        }) => {
          if (col.transform) {
            return `${col.transform} AS [${col.alias || col.code}]`
          }
          return col.alias ? `[${col.code}] AS [${col.alias}]` : `[${col.code}]`
        })
      } else {
        // Default: all columns
        columns = attributes.map(a => `[${a.code}]`)
      }
    } catch {
      columns = attributes.map(a => `[${a.code}]`)
    }
  } else {
    // Default: all columns
    columns = attributes.map(a => `[${a.code}]`)
  }
  
  // Add metadata columns based on source
  const metaColumns = sourceSchema === 'mds_master' 
    ? ['valid_from', 'valid_to', 'is_current']
    : ['load_timestamp', 'is_processed']
  
  // Build WHERE clause
  let whereClause = ''
  
  if (view.view_type === 'scd1') {
    // Only current records
    if (sourceSchema === 'mds_master') {
      whereClause = 'WHERE is_current = 1'
    } else {
      // For load table, get latest by business_key
      whereClause = `WHERE load_id IN (
        SELECT MAX(load_id) FROM ${sourceSchema}.[${sourceTable}] GROUP BY business_key
      )`
    }
  }
  // scd2 = no WHERE clause (all records)
  
  // Add custom filter condition
  if (view.filter_condition) {
    if (whereClause) {
      whereClause += ` AND (${view.filter_condition})`
    } else {
      whereClause = `WHERE ${view.filter_condition}`
    }
  }
  
  // Build final SQL
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

// GET /api/views/deploy - Get view deployment status
export async function GET(request: NextRequest) {
  logger.info('GET /api/views/deploy')
  
  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    
    let query = `
      SELECT 
        v.id,
        v.code,
        v.name,
        v.view_type,
        v.is_deployed,
        v.last_deployed_at,
        e.code as entity_code,
        e.name as entity_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.VIEWS 
          WHERE TABLE_SCHEMA = 'mds_view' AND TABLE_NAME = v.code
        ) THEN 1 ELSE 0 END AS view_exists
      FROM mds_meta.entity_view v
      JOIN mds_meta.entity e ON v.entity_id = e.id
    `
    
    const params: Record<string, unknown> = {}
    
    if (entityId) {
      query += ' WHERE v.entity_id = @entityId'
      params.entityId = parseInt(entityId)
    }
    
    query += ' ORDER BY e.name, v.name'
    
    const views = await dbQuery(query, params)
    
    return NextResponse.json({
      views,
      count: views.length
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to get deployment status')
    return NextResponse.json(
      { error: 'Failed to get deployment status' },
      { status: 500 }
    )
  }
}
