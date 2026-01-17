import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ImportSource {
  id: number
  name: string
  git_url: string | null
  git_branch: string
  dbt_project_path: string
  dbt_target: string | null
  local_path: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  last_connected_at: string | null
  error_message: string | null
  project_name: string | null
  models_json: string | null
  // dbt Profile Connection Settings
  profile_name: string | null
  db_server: string | null
  db_port: number | null
  db_database: string | null
  db_schema: string | null
  db_auth_type: string | null
  db_user: string | null
  db_password: string | null
  db_encrypt: boolean | null
  db_trust_cert: boolean | null
  created_at: string
  updated_at: string | null
}

// GET /api/settings/import-source - Get current import source config
export async function GET() {
  logger.info('GET /api/settings/import-source')
  
  try {
    const results = await dbQuery<ImportSource>(
      `SELECT * FROM mds_meta.import_source WHERE name = 'default'`
    )
    
    if (results.length === 0) {
      // Create default entry if not exists
      await dbExecute(
        `INSERT INTO mds_meta.import_source (name) VALUES ('default')`
      )
      const newResults = await dbQuery<ImportSource>(
        `SELECT * FROM mds_meta.import_source WHERE name = 'default'`
      )
      return NextResponse.json(newResults[0])
    }
    
    return NextResponse.json(results[0])
  } catch (error) {
    logger.error({ error }, 'Failed to get import source')
    return NextResponse.json(
      { error: 'Failed to get import source configuration' },
      { status: 500 }
    )
  }
}

// POST /api/settings/import-source - Update import source config
export async function POST(request: NextRequest) {
  logger.info('POST /api/settings/import-source')
  
  try {
    const body = await request.json()
    const { 
      git_url, 
      git_branch, 
      dbt_project_path, 
      dbt_target,
      // dbt Profile Connection Settings
      profile_name,
      db_server,
      db_port,
      db_database,
      db_schema,
      db_auth_type,
      db_user,
      db_password,
      db_encrypt,
      db_trust_cert
    } = body
    
    await dbExecute(
      `UPDATE mds_meta.import_source 
       SET git_url = @git_url,
           git_branch = @git_branch,
           dbt_project_path = @dbt_project_path,
           dbt_target = @dbt_target,
           profile_name = @profile_name,
           db_server = @db_server,
           db_port = @db_port,
           db_database = @db_database,
           db_schema = @db_schema,
           db_auth_type = @db_auth_type,
           db_user = @db_user,
           db_password = @db_password,
           db_encrypt = @db_encrypt,
           db_trust_cert = @db_trust_cert,
           updated_at = GETUTCDATE()
       WHERE name = 'default'`,
      {
        git_url: git_url || null,
        git_branch: git_branch || 'main',
        dbt_project_path: dbt_project_path || '/',
        dbt_target: dbt_target || null,
        profile_name: profile_name || null,
        db_server: db_server || null,
        db_port: db_port || 1433,
        db_database: db_database || null,
        db_schema: db_schema || 'dbo',
        db_auth_type: db_auth_type || 'sql',
        db_user: db_user || null,
        db_password: db_password || null,
        db_encrypt: db_encrypt !== false,
        db_trust_cert: db_trust_cert === true
      }
    )
    
    // Return updated config
    const results = await dbQuery<ImportSource>(
      `SELECT * FROM mds_meta.import_source WHERE name = 'default'`
    )
    
    return NextResponse.json(results[0])
  } catch (error) {
    logger.error({ error }, 'Failed to update import source')
    return NextResponse.json(
      { error: 'Failed to update import source configuration' },
      { status: 500 }
    )
  }
}
