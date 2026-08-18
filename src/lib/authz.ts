import { NextResponse } from 'next/server'
import { auth, type UserRole } from '@/lib/auth'
import { dbQuery } from '@/lib/db-server'

interface SessionUserWithRoles {
  roles?: UserRole[]
}

// Destructive operations (delete) are restricted to admins. Returns a
// ready-to-return NextResponse if the caller should be rejected, or null
// if the session belongs to an admin and the route can proceed.
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const roles = (session.user as SessionUserWithRoles).roles ?? []
  if (!roles.includes('admin')) {
    return NextResponse.json(
      { error: 'Forbidden: this action requires the admin role' },
      { status: 403 }
    )
  }

  return null
}

// Token-based equivalent of requireAdmin(), for /api/v1 routes. API token
// scopes are stamped once at issuance and never re-derived (see
// scopesForRoles() in src/app/api/users/[userId]/tokens/route.ts), so a
// token that had a write scope granted while its owner was admin would keep
// that scope forever even after the owner is demoted. This checks the
// user's CURRENT role live against mds_meta.user_role instead of trusting
// the token's cached scope - callers should check both: scope presence
// (verifyApiToken) AND this.
export async function requireAdminForToken(userId: number): Promise<NextResponse | null> {
  const rows = await dbQuery<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM mds_meta.user_role WHERE user_id = @userId AND role = 'admin'",
    { userId }
  )

  if (rows[0].cnt === 0) {
    return NextResponse.json(
      { error: 'Forbidden: this action requires the admin role (checked live, not just the token scope)' },
      { status: 403 }
    )
  }

  return null
}
