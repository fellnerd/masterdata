import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

interface ApiTokenRow {
  id: number
  name: string
  token_prefix: string
  scopes: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

// Scopes are derived from the user's role - keeps token issuance simple
// (no separate scope-picker UI) while matching the CRUD/RO split:
// stage gets full CRUD for editor/approver/admin, read-only for viewer;
// master and views are always read-only for everyone.
function scopesForRoles(roles: string[]): string[] {
  const scopes = new Set(['master:read', 'views:read'])
  if (roles.some(r => ['editor', 'approver', 'admin'].includes(r))) {
    scopes.add('stage:read')
    scopes.add('stage:write')
  } else {
    scopes.add('stage:read')
  }
  return Array.from(scopes)
}

// GET /api/users/[userId]/tokens - List a user's tokens (metadata only, never the secret)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  logger.info({ userId }, 'GET /api/users/[userId]/tokens')

  try {
    const tokens = await dbQuery<ApiTokenRow>(
      `SELECT id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
       FROM mds_meta.api_token
       WHERE user_id = @userId
       ORDER BY created_at DESC`,
      { userId: parseInt(userId) }
    )

    return NextResponse.json({
      data: tokens.map(t => ({ ...t, scopes: t.scopes.split(',') })),
      total: tokens.length,
    })
  } catch (error) {
    logger.error({ error, userId }, 'Failed to list tokens')
    return NextResponse.json(
      { error: 'Failed to list tokens', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/users/[userId]/tokens - Issue a new API token for this user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  logger.info({ userId }, 'POST /api/users/[userId]/tokens')

  try {
    const body = await request.json().catch(() => ({}))
    const { name, expiresInDays } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const userIdNum = parseInt(userId)
    const users = await dbQuery<{ id: number }>('SELECT id FROM mds_meta.[user] WHERE id = @userId', { userId: userIdNum })
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const roleRows = await dbQuery<{ role: string }>(
      'SELECT DISTINCT role FROM mds_meta.user_role WHERE user_id = @userId',
      { userId: userIdNum }
    )
    const scopes = scopesForRoles(roleRows.map(r => r.role))

    // mds_<32 random bytes as base64url> - shown to the caller exactly once
    const secret = randomBytes(32).toString('base64url')
    const token = `mds_${secret}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const tokenPrefix = token.slice(0, 12)

    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
      : null

    await dbExecute(
      `INSERT INTO mds_meta.api_token (user_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
       VALUES (@userId, @name, @tokenHash, @tokenPrefix, @scopes, @expiresAt, 'admin')`,
      { userId: userIdNum, name, tokenHash, tokenPrefix, scopes: scopes.join(','), expiresAt }
    )

    const created = await dbQuery<ApiTokenRow>(
      `SELECT id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
       FROM mds_meta.api_token WHERE token_hash = @tokenHash`,
      { tokenHash }
    )

    return NextResponse.json(
      {
        ...created[0],
        scopes: created[0].scopes.split(','),
        token, // full token value - only ever returned here, once
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error({ error, userId }, 'Failed to issue token')
    return NextResponse.json(
      { error: 'Failed to issue token', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/users/[userId]/tokens?tokenId=... - Revoke a token
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  logger.info({ userId }, 'DELETE /api/users/[userId]/tokens')

  try {
    const { searchParams } = new URL(request.url)
    const tokenId = searchParams.get('tokenId')

    if (!tokenId) {
      return NextResponse.json({ error: 'tokenId parameter is required' }, { status: 400 })
    }

    const rowsAffected = await dbExecute(
      `UPDATE mds_meta.api_token SET revoked_at = GETUTCDATE()
       WHERE id = @tokenId AND user_id = @userId AND revoked_at IS NULL`,
      { tokenId: parseInt(tokenId), userId: parseInt(userId) }
    )

    if (rowsAffected === 0) {
      return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error, userId }, 'Failed to revoke token')
    return NextResponse.json(
      { error: 'Failed to revoke token', details: String(error) },
      { status: 500 }
    )
  }
}
