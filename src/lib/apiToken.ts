import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { dbQuery, dbExecute } from '@/lib/db-server'

export type ApiScope = 'stage:read' | 'stage:write' | 'master:read' | 'views:read' | 'entities:read'

interface ApiTokenLookup {
  id: number
  user_id: number
  scopes: string
  expires_at: string | null
  revoked_at: string | null
}

export type ApiTokenAuthResult =
  | { ok: true; userId: number; scopes: string[] }
  | { ok: false; status: number; error: string }

// Validates the Authorization: Bearer <token> header against mds_meta.api_token
// (matched by SHA-256 hash - the plaintext secret is never stored) and checks
// that the token carries the required scope. Used by every /api/v1/* route.
export async function verifyApiToken(request: NextRequest, requiredScope: ApiScope): Promise<ApiTokenAuthResult> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing Authorization: Bearer <token> header' }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return { ok: false, status: 401, error: 'Empty bearer token' }
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const rows = await dbQuery<ApiTokenLookup>(
    `SELECT id, user_id, scopes, expires_at, revoked_at
     FROM mds_meta.api_token
     WHERE token_hash = @tokenHash`,
    { tokenHash }
  )

  if (rows.length === 0) {
    return { ok: false, status: 401, error: 'Invalid API token' }
  }

  const record = rows[0]

  if (record.revoked_at) {
    return { ok: false, status: 401, error: 'API token has been revoked' }
  }

  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return { ok: false, status: 401, error: 'API token has expired' }
  }

  const scopes = record.scopes.split(',')
  if (!scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: `Token is missing required scope: ${requiredScope}` }
  }

  // Best-effort last_used_at stamp - never let this block the actual request
  dbExecute('UPDATE mds_meta.api_token SET last_used_at = GETUTCDATE() WHERE id = @id', { id: record.id }).catch(() => {})

  return { ok: true, userId: record.user_id, scopes }
}
