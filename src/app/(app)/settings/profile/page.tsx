'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, Tag, Spinner, Callout } from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

type Role = 'admin' | 'approver' | 'editor' | 'viewer'
type Status = 'active' | 'inactive' | 'pending'

interface ApiUser {
  id: number
  email: string
  name: string | null
  image: string | null
  status: Status
  roles: Role[]
  created_at: string
  last_login_at: string | null
}

const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  approver: 'Approver',
  editor: 'Editor',
  viewer: 'Viewer',
}

const getRoleIntent = (role: Role) => {
  switch (role) {
    case 'admin': return 'danger'
    case 'approver': return 'warning'
    case 'editor': return 'primary'
    case 'viewer': return 'none'
  }
}

const getStatusIntent = (status: Status) => {
  switch (status) {
    case 'active': return 'success'
    case 'inactive': return 'none'
    case 'pending': return 'warning'
  }
}

const formatDate = (dateString: string | null) => {
  if (!dateString) return 'Never'
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export default function ProfilePage() {
  const { data: session, status: sessionStatus } = useSession()
  const [profile, setProfile] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !session?.user?.email) return

    const fetchProfile = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/users?email=${encodeURIComponent(session.user!.email!)}`)
        if (!res.ok) throw new Error('Failed to load profile')
        const json = await res.json()
        setProfile(json.data?.[0] ?? null)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [sessionStatus, session])

  const displayName = session?.user?.name || profile?.name || 'Unknown User'
  const email = session?.user?.email || profile?.email || ''
  const image = session?.user?.image || profile?.image

  return (
    <>
      <Header title="My Profile" breadcrumb={['Settings', 'Profile']} />

      <div className="page-content" style={{ maxWidth: 600 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <>
            {error && (
              <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>{error}</Callout>
            )}

            <Card style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                {image ? (
                  <img
                    src={image}
                    alt=""
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: 'var(--intent-primary, #137cbd)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 'bold', fontSize: 22
                  }}>
                    {displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{displayName}</h2>
                  <div className="text-muted">{email}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 12 }}>
                <div className="text-muted">Role</div>
                <div>
                  {profile ? (
                    profile.roles.length > 0 ? (
                      profile.roles.map(r => (
                        <Tag key={r} intent={getRoleIntent(r)} minimal style={{ marginRight: 4 }}>
                          {roleLabels[r]}
                        </Tag>
                      ))
                    ) : (
                      <Tag minimal>{roleLabels.viewer}</Tag>
                    )
                  ) : '—'}
                </div>

                <div className="text-muted">Status</div>
                <div>
                  {profile ? (
                    <Tag intent={getStatusIntent(profile.status)} minimal>{profile.status}</Tag>
                  ) : '—'}
                </div>

                <div className="text-muted">Member since</div>
                <div>{profile ? formatDate(profile.created_at) : '—'}</div>

                <div className="text-muted">Last login</div>
                <div>{profile ? formatDate(profile.last_login_at) : '—'}</div>
              </div>
            </Card>

            <Callout icon="info-sign" style={{ marginTop: 16 }}>
              Rolle und Status werden von einem Administrator unter <strong>Settings → Users</strong> verwaltet.
              Für einen API-Token wende dich an einen Administrator.
            </Callout>
          </>
        )}
      </div>
    </>
  )
}
