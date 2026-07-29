import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export interface ApiUser {
  id: number
  email: string
  name: string | null
  image: string | null
  status: 'active' | 'inactive' | 'pending'
  roles: string
  created_at: string
  last_login_at: string | null
}

const VALID_ROLES = ['viewer', 'editor', 'approver', 'admin']

// GET /api/users - List all users with their roles
export async function GET(request: NextRequest) {
  logger.info('GET /api/users')

  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')

    let sql = `
      SELECT
        u.id,
        u.email,
        u.name,
        u.image,
        u.status,
        u.created_at,
        u.last_login_at,
        COALESCE(STRING_AGG(ur.role, ','), '') AS roles
      FROM mds_meta.[user] u
      LEFT JOIN mds_meta.user_role ur ON ur.user_id = u.id
    `

    const params: Record<string, unknown> = {}
    if (email) {
      sql += ' WHERE u.email = @email'
      params.email = email
    }

    sql += `
      GROUP BY u.id, u.email, u.name, u.image, u.status, u.created_at, u.last_login_at
      ORDER BY u.email
    `

    const results = await dbQuery<ApiUser>(sql, params)

    return NextResponse.json({
      data: results.map(r => ({ ...r, roles: r.roles ? r.roles.split(',') : [] })),
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

// POST /api/users - Invite / pre-provision a user with a role (before they've ever logged in)
export async function POST(request: NextRequest) {
  logger.info('POST /api/users')

  try {
    const body = await request.json()
    const { email, name, role } = body

    if (!email || !role) {
      return NextResponse.json(
        { error: 'email and role are required' },
        { status: 400 }
      )
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    const existing = await dbQuery<{ id: number }>(
      'SELECT id FROM mds_meta.[user] WHERE email = @email',
      { email }
    )

    let userId: number

    if (existing.length > 0) {
      userId = existing[0].id
    } else {
      await dbExecute(
        `INSERT INTO mds_meta.[user] (email, name, status, created_by)
         VALUES (@email, @name, 'pending', 'admin')`,
        { email, name: name || null }
      )
      const created = await dbQuery<{ id: number }>(
        'SELECT id FROM mds_meta.[user] WHERE email = @email',
        { email }
      )
      userId = created[0].id
    }

    const existingRole = await dbQuery<{ id: number }>(
      'SELECT id FROM mds_meta.user_role WHERE user_id = @userId AND role = @role AND model_id IS NULL',
      { userId, role }
    )

    if (existingRole.length === 0) {
      await dbExecute(
        `INSERT INTO mds_meta.user_role (user_id, role, created_by) VALUES (@userId, @role, 'admin')`,
        { userId, role }
      )
    }

    const created = await dbQuery<ApiUser>(
      `SELECT u.id, u.email, u.name, u.image, u.status, u.created_at, u.last_login_at,
              COALESCE(STRING_AGG(ur.role, ','), '') AS roles
       FROM mds_meta.[user] u
       LEFT JOIN mds_meta.user_role ur ON ur.user_id = u.id
       WHERE u.id = @userId
       GROUP BY u.id, u.email, u.name, u.image, u.status, u.created_at, u.last_login_at`,
      { userId }
    )

    const result = created[0]
    return NextResponse.json(
      { ...result, roles: result.roles ? result.roles.split(',') : [] },
      { status: 201 }
    )
  } catch (error) {
    logger.error({ error }, 'Failed to create/invite user')
    return NextResponse.json(
      { error: 'Failed to create/invite user', details: String(error) },
      { status: 500 }
    )
  }
}

// PATCH /api/users - Update a user's role and/or status
export async function PATCH(request: NextRequest) {
  logger.info('PATCH /api/users')

  try {
    const body = await request.json()
    const { id, role, status } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json(
          { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      // Single global role model for the UI: replace all global (model_id IS NULL) roles
      await dbExecute('DELETE FROM mds_meta.user_role WHERE user_id = @id AND model_id IS NULL', { id })
      await dbExecute(
        `INSERT INTO mds_meta.user_role (user_id, role, created_by) VALUES (@id, @role, 'admin')`,
        { id, role }
      )
    }

    if (status !== undefined) {
      if (!['active', 'inactive', 'pending'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      await dbExecute('UPDATE mds_meta.[user] SET status = @status WHERE id = @id', { id, status })
    }

    const updated = await dbQuery<ApiUser>(
      `SELECT u.id, u.email, u.name, u.image, u.status, u.created_at, u.last_login_at,
              COALESCE(STRING_AGG(ur.role, ','), '') AS roles
       FROM mds_meta.[user] u
       LEFT JOIN mds_meta.user_role ur ON ur.user_id = u.id
       WHERE u.id = @id
       GROUP BY u.id, u.email, u.name, u.image, u.status, u.created_at, u.last_login_at`,
      { id }
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const result = updated[0]
    return NextResponse.json({ ...result, roles: result.roles ? result.roles.split(',') : [] })
  } catch (error) {
    logger.error({ error }, 'Failed to update user')
    return NextResponse.json(
      { error: 'Failed to update user', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/users - Delete a user (cascades to their roles and API tokens)
export async function DELETE(request: NextRequest) {
  logger.info('DELETE /api/users')

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id parameter is required' }, { status: 400 })
    }

    const rowsAffected = await dbExecute(
      'DELETE FROM mds_meta.[user] WHERE id = @id',
      { id: parseInt(id) }
    )

    if (rowsAffected === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error }, 'Failed to delete user')
    return NextResponse.json(
      { error: 'Failed to delete user', details: String(error) },
      { status: 500 }
    )
  }
}
