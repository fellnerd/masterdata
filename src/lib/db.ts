import sql from 'mssql'

// Connection pool (singleton)
let pool: sql.ConnectionPool | null = null

const config: sql.config = {
  server: process.env.DB_SERVER || 'sql-datavault-weu-001.database.windows.net',
  database: process.env.DB_NAME || 'Vault',
  authentication: {
    type: 'azure-active-directory-default',
    options: {
      clientId: process.env.AZURE_CLIENT_ID,
    },
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
}

// Fallback to SQL Auth if credentials provided
if (process.env.DB_USER && process.env.DB_PASSWORD) {
  config.authentication = undefined
  config.user = process.env.DB_USER
  config.password = process.env.DB_PASSWORD
}

export async function getConnection(): Promise<sql.ConnectionPool> {
  if (pool) {
    return pool
  }

  try {
    pool = await sql.connect(config)
    console.log('✅ Database connected:', config.database)
    return pool
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    throw error
  }
}

export async function query<T>(queryText: string, params?: Record<string, unknown>): Promise<T[]> {
  const conn = await getConnection()
  const request = conn.request()

  // Add parameters
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value)
    })
  }

  const result = await request.query(queryText)
  return result.recordset as T[]
}

export async function execute(queryText: string, params?: Record<string, unknown>): Promise<number> {
  const conn = await getConnection()
  const request = conn.request()

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value)
    })
  }

  const result = await request.query(queryText)
  return result.rowsAffected[0]
}

export async function closeConnection(): Promise<void> {
  if (pool) {
    await pool.close()
    pool = null
    console.log('Database connection closed')
  }
}

// Export sql types for use in other files
export { sql }
