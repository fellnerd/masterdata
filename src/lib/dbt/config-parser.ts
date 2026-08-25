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

// Blanks out (with spaces, preserving newlines) every SQL/Jinja comment -
// `{# ... #}`, `-- ...`, `/* ... */` - so paren-depth tracking can't be
// thrown off by a stray unmatched paren in free-text prose (dbt model
// headers here routinely document design decisions in German prose inside
// `{# #}` blocks, and prose is not guaranteed to have balanced parens the
// way real SQL/Jinja code is). Indices are preserved so callers can keep
// using offsets into the original string.
function stripSqlComments(text: string): string {
  let out = ''
  let quote: string | null = null
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (quote) {
      out += ch
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          out += text[i + 1]
          i += 2
          continue
        }
        quote = null
      }
      i++
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i++
      continue
    }

    if (ch === '{' && text[i + 1] === '#') {
      const end = text.indexOf('#}', i + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      out += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    out += ch
    i++
  }

  return out
}

// Splits a SELECT clause into its top-level column expressions - a plain
// comma split breaks on the commas inside CAST(...)/CASE...END/function
// calls, so this tracks paren depth and string-literal state and only
// splits on commas at depth 0.
function splitTopLevelColumns(selectClause: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < selectClause.length; i++) {
    const ch = selectClause[i]

    if (quote) {
      current += ch
      if (ch === quote) {
        // '' is an escaped quote inside a SQL string literal, not the end of it
        if (quote === "'" && selectClause[i + 1] === "'") {
          current += selectClause[++i]
        } else {
          quote = null
        }
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
    } else if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)

  return parts
}

// Derives the resulting column name for one (already comma-split) SELECT
// expression, the same way SQL Server would name it:
// - an explicit `... AS alias` (or `[alias]`) always wins
// - otherwise, a simple (possibly qualified) identifier is named after its
//   last segment (`c.product_title` -> `product_title`)
// - anything else (a bare literal, or an unaliased expression) has no
//   derivable name and is skipped rather than guessed at
function columnNameFromExpr(expr: string): string | null {
  const trimmed = expr.trim().replace(/\s+/g, ' ')
  if (!trimmed || trimmed === '*') return null

  const asMatch = trimmed.match(/\bAS\s+(\[?\w+\]?)\s*$/i)
  if (asMatch) return asMatch[1].replace(/[[\]]/g, '')

  if (/^[\w[\]]+(\.[\w[\]]+)*$/.test(trimmed)) {
    const segments = trimmed.split('.')
    return segments[segments.length - 1].replace(/[[\]]/g, '')
  }

  return null
}

// Paren depth at a given offset into text (quote-aware, matching
// splitTopLevelColumns) - used to tell a query's outermost SELECT apart
// from a SELECT nested inside a CTE body or subquery, both of which sit
// inside an extra pair of parens the outer one doesn't have.
function parenDepthAt(text: string, index: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < index; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") i++
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
  }
  return depth
}

/**
 * Extract column names from SQL file - parses the outermost SELECT
 * statement's column list rather than guessing with a single regex, so it
 * survives CTEs, CAST/CASE expressions and qualified column references.
 * CTE bodies and subqueries are skipped (they sit at paren depth > 0): their
 * columns don't necessarily appear in - or keep the same name as in - the
 * query's actual result set.
 */
function extractColumnsFromSql(sqlContent: string): string[] {
  const columns: string[] = []

  // Comments stripped first (see stripSqlComments) so a stray unmatched
  // paren in free-text prose can't throw off the depth tracking below.
  const cleaned = stripSqlComments(sqlContent)

  // Try to find columns in the final SELECT statement or CTE
  // Pattern: looks for column names in SELECT ... FROM patterns
  const selectPattern = /SELECT\s+([\s\S]*?)\s+FROM/gi
  const matches = cleaned.matchAll(selectPattern)

  for (const match of matches) {
    if (parenDepthAt(cleaned, match.index) !== 0) continue

    const selectClause = match[1]
    for (const part of splitTopLevelColumns(selectClause)) {
      const colName = columnNameFromExpr(part)
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

  // automate_dv (Data Vault) models are typically a single macro call with
  // no SELECT/FROM at all, and this project's convention embeds the source
  // column list as a YAML block inside a Jinja {% set %}/{% endset %},
  // then passes it to the macro via fromyaml()/metadata_dict[...] - e.g.:
  //
  //   {%- set yaml_metadata -%}
  //   src_pk: "hk_werk"
  //   src_hashdiff:
  //     source_column: "hd_werk"
  //     alias: "hashdiff"
  //   src_payload:
  //     - "NAME"
  //     - "KUERZEL"
  //   {%- endset -%}
  //   {% set metadata_dict = fromyaml(yaml_metadata) %}
  //   {{ automate_dv.sat(src_pk=metadata_dict["src_pk"], ...) }}
  //
  // Neither of the extraction patterns above can see any of this (no
  // SELECT, and no literal `key="value"` at the macro call site itself -
  // the values only exist inside the YAML block), so hub/sat/link models
  // built this way always resolved to an empty column list. Find each such
  // block and parse it as actual YAML instead of guessing with more regex,
  // then take every string value in it (source_model is the only non-column
  // string these blocks conventionally carry, so it's excluded explicitly).
  const setBlockPattern = /\{%-?\s*set\s+\w+\s*-?%\}([\s\S]*?)\{%-?\s*endset\s*-?%\}/g
  for (const match of sqlContent.matchAll(setBlockPattern)) {
    let parsed: unknown
    try {
      parsed = yaml.load(match[1])
    } catch {
      continue
    }
    collectYamlStringValues(parsed, columns)
  }

  return columns
}

// Recursively collects every string leaf value from a parsed YAML metadata
// block (see extractColumnsFromSql) - covers plain `key: "col"`, list items
// under `key: [...]`, and nested `key: { source_column: "...", alias: "..." }`.
function collectYamlStringValues(value: unknown, into: string[], key?: string): void {
  if (key === 'source_model') return
  if (typeof value === 'string') {
    if (value && !into.includes(value)) into.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectYamlStringValues(item, into)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectYamlStringValues(v, into, k)
    }
  }
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
