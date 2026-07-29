import { NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { parseDbtProjectFull } from '@/lib/dbt/config-parser'
import * as yaml from 'js-yaml'

const execFileAsync = promisify(execFile)

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
  // Git auth + GitHub Actions
  git_auth_type: string | null
  git_ssh_private_key: string | null
}

interface WorkflowInfo {
  filename: string
  name: string
  path: string
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

/**
 * Scan .github/workflows/*.yml|*.yaml at the repo root and extract each
 * workflow's display name (falls back to filename if `name:` is missing).
 * This only reads files already on disk from the clone - no GitHub API
 * call, so it works with a read-only SSH deploy key alone.
 */
function scanGithubWorkflows(repoRoot: string): WorkflowInfo[] {
  const workflowsDir = path.join(repoRoot, '.github', 'workflows')
  if (!fs.existsSync(workflowsDir)) return []

  const workflows: WorkflowInfo[] = []
  for (const filename of fs.readdirSync(workflowsDir)) {
    if (!filename.endsWith('.yml') && !filename.endsWith('.yaml')) continue
    const filePath = path.join(workflowsDir, filename)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = yaml.load(content) as Record<string, unknown> | undefined
      const name = (parsed && typeof parsed.name === 'string' && parsed.name) || filename
      workflows.push({ filename, name, path: `.github/workflows/${filename}` })
    } catch (err) {
      logger.warn({ err, filename }, 'Failed to parse workflow file, skipping')
    }
  }
  return workflows
}

// POST /api/settings/import-source/connect - Clone repo and validate
export async function POST() {
  logger.info('POST /api/settings/import-source/connect')

  let sshKeyPath: string | null = null

  try {
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

    await dbExecute(
      `UPDATE mds_meta.import_source
       SET status = 'connecting',
           error_message = NULL,
           updated_at = GETUTCDATE()
       WHERE name = 'default'`
    )

    try {
      let projectPath: string
      let repoRoot: string

      if (isLocalPath(config.git_url)) {
        logger.info({ path: config.git_url }, 'Using local path')

        const basePath = config.git_url.startsWith('~')
          ? config.git_url.replace('~', os.homedir())
          : config.git_url

        repoRoot = basePath
        projectPath = config.dbt_project_path === '/'
          ? basePath
          : path.join(basePath, config.dbt_project_path)

        if (!fs.existsSync(projectPath)) {
          throw new Error(`Local path does not exist: ${projectPath}`)
        }
      } else {
        if (fs.existsSync(TEMP_DIR)) {
          fs.rmSync(TEMP_DIR, { recursive: true, force: true })
        }

        logger.info({ url: config.git_url, branch: config.git_branch, authType: config.git_auth_type }, 'Cloning repository')

        // Build env for the clone - only override GIT_SSH_COMMAND when an
        // SSH deploy key is configured, so plain public-repo HTTPS clones
        // are unaffected.
        const cloneEnv = { ...process.env }

        if (config.git_auth_type === 'ssh_key' && config.git_ssh_private_key) {
          sshKeyPath = path.join(os.tmpdir(), `mds-deploy-key-${crypto.randomUUID()}`)
          // Deploy keys must end in exactly one newline or ssh silently rejects them
          const keyContent = config.git_ssh_private_key.trim() + '\n'
          fs.writeFileSync(sshKeyPath, keyContent, { mode: 0o600 })
          cloneEnv.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
        }

        // execFile with an argv array (not a shell string) - avoids command
        // injection via git_branch/git_url, unlike the previous exec() call.
        await execFileAsync(
          'git',
          ['clone', '--depth', '1', '--branch', config.git_branch, config.git_url, TEMP_DIR],
          { timeout: 60000, env: cloneEnv }
        )

        repoRoot = TEMP_DIR
        projectPath = config.dbt_project_path === '/'
          ? TEMP_DIR
          : path.join(TEMP_DIR, config.dbt_project_path)
      }

      const parseResult = parseDbtProjectFull(projectPath)

      if (!parseResult.success) {
        throw new Error(parseResult.error || 'Failed to parse dbt project')
      }

      const profileName = config.profile_name || parseResult.projectName || 'datavault'

      if (config.db_server && config.db_database) {
        const profilesContent = generateProfilesYml(config, profileName)
        const profilesPath = path.join(projectPath, 'profiles.yml')

        fs.writeFileSync(profilesPath, profilesContent, 'utf-8')
        logger.info({ profilesPath, profileName }, 'Generated profiles.yml')
      } else {
        logger.warn('No database connection settings provided, profiles.yml not generated')
      }

      const workflows = scanGithubWorkflows(repoRoot)

      await dbExecute(
        `UPDATE mds_meta.import_source
         SET status = 'connected',
             local_path = @localPath,
             project_name = @projectName,
             profile_name = @profileName,
             models_json = @modelsJson,
             workflows_json = @workflowsJson,
             last_connected_at = GETUTCDATE(),
             error_message = NULL,
             updated_at = GETUTCDATE()
         WHERE name = 'default'`,
        {
          localPath: projectPath,
          projectName: parseResult.projectName,
          profileName: profileName,
          modelsJson: JSON.stringify(parseResult.models),
          workflowsJson: JSON.stringify(workflows)
        }
      )

      logger.info({
        projectName: parseResult.projectName,
        modelCount: parseResult.models?.length,
        workflowCount: workflows.length
      }, 'Successfully connected to dbt project')

      return NextResponse.json({
        success: true,
        projectName: parseResult.projectName,
        modelCount: parseResult.models?.length || 0,
        workflowCount: workflows.length,
        message: 'Successfully connected to dbt project'
      })

    } catch (cloneError) {
      const errorMessage = cloneError instanceof Error ? cloneError.message : 'Unknown error'

      await dbExecute(
        `UPDATE mds_meta.import_source
         SET status = 'error',
             error_message = @errorMessage,
             updated_at = GETUTCDATE()
         WHERE name = 'default'`,
        { errorMessage }
      )

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
  } finally {
    // Always remove the deploy key from disk, success or failure
    if (sshKeyPath && fs.existsSync(sshKeyPath)) {
      fs.rmSync(sshKeyPath, { force: true })
    }
  }
}
