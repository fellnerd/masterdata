/**
 * dbt Config Parser
 * 
 * Parses dbt_project.yml and model files to extract available objects
 * for import mapping UI.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

export interface DbtModel {
  name: string
  schema: string
  type: 'hub' | 'satellite' | 'link' | 'view' | 'table' | 'staging' | 'mart' | 'pit' | 'bridge'
  materialized: 'view' | 'table' | 'incremental' | 'ephemeral'
  filePath: string
  columns: string[]
}

export interface DbtProjectConfig {
  name: string
  version: string
  modelPaths: string[]
  models: Record<string, unknown>
}

export interface ParseResult {
  success: boolean
  projectName?: string
  models?: DbtModel[]
  error?: string
}

/**
 * Parse dbt_project.yml file
 */
export function parseDbtProject(projectPath: string): DbtProjectConfig | null {
  const dbtProjectPath = path.join(projectPath, 'dbt_project.yml')
  
  if (!fs.existsSync(dbtProjectPath)) {
    return null
  }
  
  try {
    const content = fs.readFileSync(dbtProjectPath, 'utf8')
    const config = yaml.load(content) as Record<string, unknown>
    
    return {
      name: config.name as string || 'unknown',
      version: config.version as string || '1.0.0',
      modelPaths: (config['model-paths'] as string[]) || ['models'],
      models: (config.models as Record<string, unknown>) || {}
    }
  } catch (error) {
    console.error('Error parsing dbt_project.yml:', error)
    return null
  }
}

/**
 * Extract schema from dbt_project.yml model config
 */
function getSchemaFromConfig(
  models: Record<string, unknown>,
  projectName: string,
  modelPath: string[]
): string {
  // Traverse model config to find schema
  let current: Record<string, unknown> = models[projectName] as Record<string, unknown> || {}
  
  for (const part of modelPath) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part] as Record<string, unknown>
    } else {
      break
    }
  }
  
  // Look for +schema in current level or parent levels
  if (current && typeof current === 'object') {
    const schema = (current as Record<string, string>)['+schema']
    if (schema) return schema
  }
  
  return 'public'
}

/**
 * Determine model type from path and name
 */
function inferModelType(filePath: string, fileName: string): DbtModel['type'] {
  const pathLower = filePath.toLowerCase()
  const nameLower = fileName.toLowerCase()
  
  if (pathLower.includes('/hubs/') || nameLower.startsWith('hub_')) return 'hub'
  if (pathLower.includes('/satellites/') || nameLower.startsWith('sat_')) return 'satellite'
  if (pathLower.includes('/links/') || nameLower.startsWith('link_')) return 'link'
  if (pathLower.includes('/staging/') || nameLower.startsWith('stg_')) return 'staging'
  if (pathLower.includes('/mart/') || pathLower.includes('/marts/')) return 'mart'
  if (pathLower.includes('/business_vault/')) {
    if (nameLower.startsWith('pit_')) return 'pit'
    if (nameLower.startsWith('bridge_')) return 'bridge'
    return 'table'
  }
  
  return 'view'
}

/**
 * Extract column names from SQL file
 * Simple regex-based extraction from SELECT statements
 */
function extractColumnsFromSql(sqlContent: string): string[] {
  const columns: string[] = []
  
  // Try to find columns in the final SELECT statement or CTE
  // Pattern: looks for column names in SELECT ... FROM patterns
  const selectPattern = /SELECT\s+([\s\S]*?)\s+FROM/gi
  const matches = sqlContent.matchAll(selectPattern)
  
  for (const match of matches) {
    const selectClause = match[1]
    // Extract column names (simplified - handles common patterns)
    const columnMatches = selectClause.matchAll(/(?:^|,)\s*(?:[\w.]+\s+AS\s+)?(\w+)\s*(?:,|$)/gi)
    for (const colMatch of columnMatches) {
      const colName = colMatch[1]
      if (colName && !columns.includes(colName) && !colName.match(/^(SELECT|FROM|WHERE|AND|OR)$/i)) {
        columns.push(colName)
      }
    }
  }
  
  // Also look for explicit column definitions in Jinja macros
  const jinjaColPattern = /['"](\w+)['"]\s*:/g
  const jinjaMatches = sqlContent.matchAll(jinjaColPattern)
  for (const match of jinjaMatches) {
    const colName = match[1]
    if (colName && !columns.includes(colName)) {
      columns.push(colName)
    }
  }
  
  return columns
}

/**
 * Recursively find all .sql files in a directory
 */
function findSqlFiles(dir: string, baseDir: string, files: { path: string; relativePath: string }[] = []): { path: string; relativePath: string }[] {
  if (!fs.existsSync(dir)) return files
  
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)
    
    if (entry.isDirectory()) {
      findSqlFiles(fullPath, baseDir, files)
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      files.push({ path: fullPath, relativePath })
    }
  }
  
  return files
}

/**
 * Parse all models from a dbt project
 */
export function parseModels(projectPath: string, config: DbtProjectConfig): DbtModel[] {
  const models: DbtModel[] = []
  
  for (const modelDir of config.modelPaths) {
    const modelsPath = path.join(projectPath, modelDir)
    const sqlFiles = findSqlFiles(modelsPath, modelsPath)
    
    for (const { path: filePath, relativePath } of sqlFiles) {
      const fileName = path.basename(filePath, '.sql')
      const dirPath = path.dirname(relativePath).split(path.sep).filter(Boolean)
      
      // Skip test files
      if (fileName.startsWith('test_') || dirPath.includes('tests')) continue
      
      // Get schema from config
      const schema = getSchemaFromConfig(config.models, config.name, dirPath)
      
      // Read SQL content for column extraction
      let columns: string[] = []
      try {
        const sqlContent = fs.readFileSync(filePath, 'utf8')
        columns = extractColumnsFromSql(sqlContent)
      } catch {
        // Ignore read errors
      }
      
      // Determine materialization from config
      let materialized: DbtModel['materialized'] = 'view'
      let current = config.models[config.name] as Record<string, unknown>
      for (const part of dirPath) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part] as Record<string, unknown>
          if (current && '+materialized' in current) {
            materialized = current['+materialized'] as DbtModel['materialized']
          }
        }
      }
      
      models.push({
        name: fileName,
        schema,
        type: inferModelType(relativePath, fileName),
        materialized,
        filePath: relativePath,
        columns
      })
    }
  }
  
  return models
}

/**
 * Validate dbt project structure
 * Checks if project has expected Data Vault structure
 */
export function validateDbtProject(projectPath: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check dbt_project.yml exists
  const dbtProjectPath = path.join(projectPath, 'dbt_project.yml')
  if (!fs.existsSync(dbtProjectPath)) {
    errors.push('dbt_project.yml not found')
    return { valid: false, errors }
  }
  
  const config = parseDbtProject(projectPath)
  if (!config) {
    errors.push('Failed to parse dbt_project.yml')
    return { valid: false, errors }
  }
  
  // Check models directory exists
  const modelsPath = path.join(projectPath, config.modelPaths[0] || 'models')
  if (!fs.existsSync(modelsPath)) {
    errors.push(`Models directory not found: ${config.modelPaths[0] || 'models'}`)
  }
  
  // Check for Data Vault structure (optional but recommended)
  const hasRawVault = fs.existsSync(path.join(modelsPath, 'raw_vault'))
  const hasStaging = fs.existsSync(path.join(modelsPath, 'staging'))
  
  if (!hasRawVault && !hasStaging) {
    // Not a strict error, just a warning
    console.warn('Project does not have typical Data Vault structure (raw_vault, staging)')
  }
  
  return { valid: errors.length === 0, errors }
}

/**
 * Full parse of a dbt project
 * Returns all models with their metadata
 */
export function parseDbtProjectFull(projectPath: string): ParseResult {
  const validation = validateDbtProject(projectPath)
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join('; ')
    }
  }
  
  const config = parseDbtProject(projectPath)
  if (!config) {
    return {
      success: false,
      error: 'Failed to parse dbt_project.yml'
    }
  }
  
  const models = parseModels(projectPath, config)
  
  return {
    success: true,
    projectName: config.name,
    models
  }
}
