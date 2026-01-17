'use server';

import sql from 'mssql';

// Connection pool (singleton)
let pool: sql.ConnectionPool | null = null;

// Mock mode flag - set to true for development without database
const USE_MOCK = process.env.DB_MOCK === 'true';

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
    requestTimeout: 120000, // 2 minutes for bulk operations
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Fallback to SQL Auth if credentials provided
if (process.env.DB_USER && process.env.DB_PASSWORD) {
  config.authentication = undefined;
  config.user = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

async function getConnection(): Promise<sql.ConnectionPool> {
  if (pool) {
    return pool;
  }

  try {
    pool = await sql.connect(config);
    console.log('✅ Database connected:', config.database);
    return pool;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

// Mock data for development
const mockData: Record<string, unknown[]> = {
  models: [
    { id: 1, code: 'CRM', name: 'CRM Master Data', description: 'Customer data', version: 1, status: 'active', source_database: 'werkportal', target_schema: 'vault', created_at: new Date().toISOString(), created_by: 'admin', updated_at: new Date().toISOString(), updated_by: 'admin', entity_count: 3 },
    { id: 2, code: 'PRODUCTS', name: 'Product Catalog', description: 'Product master data', version: 1, status: 'draft', source_database: 'werkportal', target_schema: 'vault', created_at: new Date().toISOString(), created_by: 'admin', updated_at: new Date().toISOString(), updated_by: 'admin', entity_count: 2 },
  ],
  entities: [
    { id: 1, model_id: 1, model_code: 'CRM', model_name: 'CRM Master Data', code: 'customer', name: 'Customer', description: 'Customer master data', source_table: 'public.company_client', staging_view: 'stg_company_client', hub_name: 'hub_company_client', is_deployed: true, record_count: 1250, attribute_count: 8, created_at: new Date().toISOString(), created_by: 'admin', updated_at: new Date().toISOString(), updated_by: 'admin' },
    { id: 2, model_id: 1, model_code: 'CRM', model_name: 'CRM Master Data', code: 'contact', name: 'Contact', description: 'Contacts', source_table: 'public.contact', staging_view: 'stg_contact', hub_name: 'hub_contact', is_deployed: false, record_count: 0, attribute_count: 6, created_at: new Date().toISOString(), created_by: 'admin', updated_at: new Date().toISOString(), updated_by: 'admin' },
    { id: 3, model_id: 1, model_code: 'CRM', model_name: 'CRM Master Data', code: 'country', name: 'Country', description: 'Country reference', source_table: 'public.country', staging_view: 'stg_country', hub_name: 'hub_country', is_deployed: true, record_count: 195, attribute_count: 4, created_at: new Date().toISOString(), created_by: 'admin', updated_at: new Date().toISOString(), updated_by: 'admin' },
  ],
  users: [
    { id: 1, user_id: 'dev-admin-001', email: 'admin@example.com', display_name: 'Admin User', role: 'admin', model_id: null, created_at: new Date().toISOString(), created_by: 'system' },
    { id: 2, user_id: 'dev-editor-001', email: 'editor@example.com', display_name: 'Editor User', role: 'editor', model_id: null, created_at: new Date().toISOString(), created_by: 'system' },
    { id: 3, user_id: 'dev-approver-001', email: 'approver@example.com', display_name: 'Approver User', role: 'approver', model_id: null, created_at: new Date().toISOString(), created_by: 'system' },
    { id: 4, user_id: 'dev-viewer-001', email: 'viewer@example.com', display_name: 'Viewer User', role: 'viewer', model_id: null, created_at: new Date().toISOString(), created_by: 'system' },
  ],
};

function getMockData(queryText: string): unknown[] {
  const query = queryText.toLowerCase();
  if (query.includes('[mds_meta].[model]') || query.includes('mds_meta.model')) {
    return mockData.models;
  }
  if (query.includes('[mds_meta].[entity]') || query.includes('mds_meta.entity')) {
    return mockData.entities;
  }
  if (query.includes('[mds_meta].[user_role]') || query.includes('mds_meta.user_role')) {
    return mockData.users;
  }
  return [];
}

export async function dbQuery<T>(queryText: string, params?: Record<string, unknown>): Promise<T[]> {
  if (USE_MOCK) {
    console.log('📦 Using mock data for query');
    return getMockData(queryText) as T[];
  }
  
  const conn = await getConnection();
  const request = conn.request();

  // Add parameters
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value);
    });
  }

  const result = await request.query(queryText);
  return result.recordset as T[];
}

export async function dbExecute(queryText: string, params?: Record<string, unknown>): Promise<number> {
  if (USE_MOCK) {
    console.log('📦 Mock execute:', queryText.substring(0, 50));
    return 1;
  }
  
  const conn = await getConnection();
  const request = conn.request();

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value);
    });
  }

  const result = await request.query(queryText);
  return result.rowsAffected[0];
}
