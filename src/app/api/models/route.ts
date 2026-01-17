import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Types matching database schema
export interface Model {
  id: number
  code: string
  name: string
  description: string | null
  version: number
  status: 'draft' | 'active' | 'deprecated'
  source_database: string | null
  target_schema: string | null
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
  // Computed fields
  entity_count?: number
  record_count?: number
}

// GET /api/models - List all models
export async function GET() {
  logger.info('GET /api/models')
  
  try {
    const results = await dbQuery<Model>(`
      SELECT 
        m.id,
        m.code,
        m.name,
        m.description,
        m.version,
        m.status,
        m.source_database,
        m.target_schema,
        m.created_at,
        m.created_by,
        m.updated_at,
        m.updated_by,
        (SELECT COUNT(*) FROM [mds_meta].[entity] e WHERE e.model_id = m.id) AS entity_count
      FROM [mds_meta].[model] m
      ORDER BY m.name
    `)
    
    return NextResponse.json({
      data: results,
      total: results.length,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch models')
    return NextResponse.json(
      { error: 'Failed to fetch models', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/models - Create new model
export async function POST(request: NextRequest) {
  logger.info('POST /api/models')
  
  try {
    const body = await request.json()
    const { code, name, description, source_database, target_schema } = body
    
    if (!code || !name) {
      return NextResponse.json(
        { error: 'Model code and name are required' },
        { status: 400 }
      )
    }
    
    // Check for duplicate code
    const existing = await dbQuery<{ id: number }>(
      'SELECT id FROM [mds_meta].[model] WHERE code = @code',
      { code }
    )
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Model with this code already exists' },
        { status: 409 }
      )
    }
    
    // Get user from session (TODO: implement properly)
    const currentUser = 'admin'
    
    // Insert new model
    await dbExecute(
      `INSERT INTO [mds_meta].[model] 
        (code, name, description, source_database, target_schema, created_by, updated_by)
       VALUES (@code, @name, @description, @source_database, @target_schema, @user, @user)`,
      { 
        code, 
        name, 
        description: description || null, 
        source_database: source_database || null,
        target_schema: target_schema || null,
        user: currentUser 
      }
    )
    
    // Fetch the created model
    const created = await dbQuery<Model>(
      `SELECT * FROM [mds_meta].[model] WHERE code = @code`,
      { code }
    )
    
    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create model')
    return NextResponse.json(
      { error: 'Failed to create model', details: String(error) },
      { status: 500 }
    )
  }
}
