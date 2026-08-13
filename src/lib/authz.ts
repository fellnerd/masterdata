import { NextResponse } from 'next/server'
import { auth, type UserRole } from '@/lib/auth'

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
