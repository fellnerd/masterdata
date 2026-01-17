import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { logger } from '@/lib/logger'

// Types matching database schema
export interface UserRole {
  id: number
  user_id: string
  email: string
  display_name: string | null
  role: 'viewer' | 'editor' | 'approver' | 'admin'
  model_id: number | null
  model_name?: string | null
  created_at: string
  created_by: string
}

// GET /api/users - List all user roles
export async function GET(request: NextRequest) {
  logger.info('GET /api/users')
  
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    const userId = searchParams.get('user_id')
    
    let sql = `
      SELECT 
        ur.id,
        ur.user_id,
        ur.email,
        ur.display_name,
        ur.role,
        ur.model_id,
        m.name AS model_name,
        ur.created_at,
        ur.created_by
      FROM [mds_meta].[user_role] ur
      LEFT JOIN [mds_meta].[model] m ON m.id = ur.model_id
    `
    
    const conditions: string[] = []
    const params: Record<string, unknown> = {}
    
    if (email) {
      conditions.push('ur.email = @email')
      params.email = email
    }
    
    if (userId) {
      conditions.push('ur.user_id = @userId')
      params.userId = userId
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    
    sql += ' ORDER BY ur.email, ur.role'
    
    const results = await query<UserRole>(sql, params)
    
    return NextResponse.json({
      data: results,
      total: results.length,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch users')
    return NextResponse.json(
      { error: 'Failed to fetch users', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/users - Create new user role
export async function POST(request: NextRequest) {
  logger.info('POST /api/users')
  
  try {
    const body = await request.json()
    const { user_id, email, display_name, role, model_id } = body
    
    if (!user_id || !email || !role) {
      return NextResponse.json(
        { error: 'user_id, email, and role are required' },
        { status: 400 }
      )
    }
    
    // Validate role
    const validRoles = ['viewer', 'editor', 'approver', 'admin']
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      )
    }
    
    // Check for duplicate
    const existing = await query<{ id: number }>(
      `SELECT id FROM [mds_meta].[user_role] 
       WHERE user_id = @userId AND role = @role AND (model_id = @modelId OR (model_id IS NULL AND @modelId IS NULL))`,
      { userId: user_id, role, modelId: model_id || null }
    )
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'This user already has this role' },
        { status: 409 }
      )
    }
    
    const currentUser = 'admin'
    
    await execute(
      `INSERT INTO [mds_meta].[user_role] 
        (user_id, email, display_name, role, model_id, created_by)
       VALUES (@userId, @email, @displayName, @role, @modelId, @createdBy)`,
      { 
        userId: user_id,
        email,
        displayName: display_name || null,
        role,
        modelId: model_id || null,
        createdBy: currentUser 
      }
    )
    
    // Fetch the created user role
    const created = await query<UserRole>(
      `SELECT ur.*, m.name AS model_name
       FROM [mds_meta].[user_role] ur
       LEFT JOIN [mds_meta].[model] m ON m.id = ur.model_id
       WHERE ur.user_id = @userId AND ur.role = @role
       ORDER BY ur.id DESC`,
      { userId: user_id, role }
    )
    
    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create user role')
    return NextResponse.json(
      { error: 'Failed to create user role', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/users - Delete user role
export async function DELETE(request: NextRequest) {
  logger.info('DELETE /api/users')
  
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      )
    }
    
    const rowsAffected = await execute(
      'DELETE FROM [mds_meta].[user_role] WHERE id = @id',
      { id: parseInt(id) }
    )
    
    if (rowsAffected === 0) {
      return NextResponse.json(
        { error: 'User role not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error }, 'Failed to delete user role')
    return NextResponse.json(
      { error: 'Failed to delete user role', details: String(error) },
      { status: 500 }
    )
  }
}
