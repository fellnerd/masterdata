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
  // Git auth (SSH deploy key) + GitHub Actions
  git_auth_type: 'none' | 'ssh_key'
  git_ssh_private_key: string | null
  github_api_token: string | null
  workflows_json: string | null
  created_at: string
  updated_at: string | null
}

// Never send stored secrets back to the browser - replace with presence flags instead.
function redactSecrets(config: ImportSource) {
  const { db_password, git_ssh_private_key, github_api_token, ...rest } = config
  return {
    ...rest,
    has_db_password: !!db_password,
    has_git_ssh_private_key: !!git_ssh_private_key,
    has_github_api_token: !!github_api_token,
  }
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
      return NextResponse.json(redactSecrets(newResults[0]))
    }

    return NextResponse.json(redactSecrets(results[0]))
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
      db_trust_cert,
      // Git auth + GitHub Actions
      git_auth_type,
      git_ssh_private_key,
      github_api_token
    } = body

    // Preserve the existing SSH key / API token when the field is omitted
    // from the request (the UI doesn't resend secrets it fetched masked).
    const existing = await dbQuery<{ git_ssh_private_key: string | null; github_api_token: string | null }>(
      `SELECT git_ssh_private_key, github_api_token FROM mds_meta.import_source WHERE name = 'default'`
    )
    const currentSshKey = existing[0]?.git_ssh_private_key ?? null
    const currentApiToken = existing[0]?.github_api_token ?? null

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
           git_auth_type = @git_auth_type,
           git_ssh_private_key = @git_ssh_private_key,
           github_api_token = @github_api_token,
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
        db_trust_cert: db_trust_cert === true,
        git_auth_type: git_auth_type || 'none',
        git_ssh_private_key: git_ssh_private_key !== undefined ? (git_ssh_private_key || null) : currentSshKey,
        github_api_token: github_api_token !== undefined ? (github_api_token || null) : currentApiToken
      }
    )
    
    // Return updated config
    const results = await dbQuery<ImportSource>(
      `SELECT * FROM mds_meta.import_source WHERE name = 'default'`
    )
    
    return NextResponse.json(redactSecrets(results[0]))
  } catch (error) {
    logger.error({ error }, 'Failed to update import source')
    return NextResponse.json(
      { error: 'Failed to update import source configuration' },
      { status: 500 }
    )
  }
}
