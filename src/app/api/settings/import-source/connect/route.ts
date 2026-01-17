import { NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { parseDbtProjectFull } from '@/lib/dbt/config-parser'
import * as yaml from 'js-yaml'

const execAsync = promisify(exec)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEMP_DIR = path.join(os.tmpdir(), 'mds-dbt-source')

interface ImportSource {
  id: number
  git_url: string | null
  git_branch: string
  dbt_project_path: string
  dbt_target: string | null
  local_path: string | null
  status: string
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
}

/**
 * Check if the URL is a local file path
 */
function isLocalPath(url: string): boolean {
  return url.startsWith('/') || url.startsWith('.') || url.startsWith('~')
}

/**
 * Generate profiles.yml content for dbt
 */
function generateProfilesYml(config: ImportSource, profileName: string): string {
  const target = config.dbt_target || 'dev'
  
  // Build the profile configuration
  const profile: Record<string, unknown> = {
    [profileName]: {
      target: target,
      outputs: {
        [target]: {
          type: 'sqlserver',
          driver: 'ODBC Driver 18 for SQL Server',
          server: config.db_server,
          port: config.db_port || 1433,
          database: config.db_database,
          schema: config.db_schema || 'dbo',
          authentication: config.db_auth_type || 'sql',
          encrypt: config.db_encrypt !== false,
          trust_cert: config.db_trust_cert === true,
          ...(config.db_auth_type === 'sql' && config.db_user && {
            user: config.db_user,
            password: config.db_password || ''
          })
        }
      }
    }
  }
  
  return yaml.dump(profile, { 
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false
  })
}

// POST /api/settings/import-source/connect - Clone repo and validate
export async function POST() {
  logger.info('POST /api/settings/import-source/connect')
  
  try {
    // Get current config
    const configs = await dbQuery<ImportSource>(
      `SELECT * FROM mds_meta.import_source WHERE name = 'default'`
    )
    
    if (configs.length === 0) {
      return NextResponse.json(
        { error: 'No import source configuration found' },
        { status: 404 }
      )
    }
    
    const config = configs[0]
    
    if (!config.git_url) {
      return NextResponse.json(
        { error: 'Git URL or local path is required' },
        { status: 400 }
      )
    }
    
    // Update status to connecting
    await dbExecute(
      `UPDATE mds_meta.import_source 
       SET status = 'connecting', 
           error_message = NULL,
           updated_at = GETUTCDATE() 
       WHERE name = 'default'`
    )
    
    try {
      let projectPath: string
      
      // Check if it's a local path or git URL
      if (isLocalPath(config.git_url)) {
        // Local path - use directly
        logger.info({ path: config.git_url }, 'Using local path')
        
        const basePath = config.git_url.startsWith('~') 
          ? config.git_url.replace('~', os.homedir())
          : config.git_url
        
        projectPath = config.dbt_project_path === '/' 
          ? basePath 
          : path.join(basePath, config.dbt_project_path)
        
        if (!fs.existsSync(projectPath)) {
          throw new Error(`Local path does not exist: ${projectPath}`)
        }
      } else {
        // Git URL - clone to temp directory
        // Clean up existing temp directory
        if (fs.existsSync(TEMP_DIR)) {
          fs.rmSync(TEMP_DIR, { recursive: true, force: true })
        }
        
        logger.info({ url: config.git_url, branch: config.git_branch }, 'Cloning repository')
        
        const cloneCmd = `git clone --depth 1 --branch ${config.git_branch} "${config.git_url}" "${TEMP_DIR}"`
        await execAsync(cloneCmd, { timeout: 60000 })
        
        projectPath = config.dbt_project_path === '/' 
          ? TEMP_DIR 
          : path.join(TEMP_DIR, config.dbt_project_path)
      }
      
      // Validate and parse dbt project
      const parseResult = parseDbtProjectFull(projectPath)
      
      if (!parseResult.success) {
        throw new Error(parseResult.error || 'Failed to parse dbt project')
      }
      
      // Generate profiles.yml if db connection settings are provided
      const profileName = config.profile_name || parseResult.projectName || 'datavault'
      
      if (config.db_server && config.db_database) {
        const profilesContent = generateProfilesYml(config, profileName)
        const profilesPath = path.join(projectPath, 'profiles.yml')
        
        fs.writeFileSync(profilesPath, profilesContent, 'utf-8')
        logger.info({ profilesPath, profileName }, 'Generated profiles.yml')
      } else {
        logger.warn('No database connection settings provided, profiles.yml not generated')
      }
      
      // Update database with success
      await dbExecute(
        `UPDATE mds_meta.import_source 
         SET status = 'connected',
             local_path = @localPath,
             project_name = @projectName,
             profile_name = @profileName,
             models_json = @modelsJson,
             last_connected_at = GETUTCDATE(),
             error_message = NULL,
             updated_at = GETUTCDATE()
         WHERE name = 'default'`,
        {
          localPath: projectPath,
          projectName: parseResult.projectName,
          profileName: profileName,
          modelsJson: JSON.stringify(parseResult.models)
        }
      )
      
      logger.info({ 
        projectName: parseResult.projectName, 
        modelCount: parseResult.models?.length 
      }, 'Successfully connected to dbt project')
      
      return NextResponse.json({
        success: true,
        projectName: parseResult.projectName,
        modelCount: parseResult.models?.length || 0,
        message: 'Successfully connected to dbt project'
      })
      
    } catch (cloneError) {
      // Update status to error
      const errorMessage = cloneError instanceof Error ? cloneError.message : 'Unknown error'
      
      await dbExecute(
        `UPDATE mds_meta.import_source 
         SET status = 'error',
             error_message = @errorMessage,
             updated_at = GETUTCDATE()
         WHERE name = 'default'`,
        { errorMessage }
      )
      
      // Clean up on error
      if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true })
      }
      
      logger.error({ error: cloneError }, 'Failed to connect to dbt project')
      
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      )
    }
    
  } catch (error) {
    logger.error({ error }, 'Failed to process connect request')
    return NextResponse.json(
      { error: 'Failed to connect to import source' },
      { status: 500 }
    )
  }
}
