'use client'

import { useState, useEffect } from 'react'
import {
  Button,
  HTMLTable,
  Tag,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Callout,
  Spinner,
  NonIdealState,
  Alert
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

type Role = 'admin' | 'approver' | 'editor' | 'viewer'
type Status = 'active' | 'inactive' | 'pending'

interface User {
  id: number
  email: string
  name: string | null
  image: string | null
  status: Status
  roles: Role[]
  created_at: string
  last_login_at: string | null
}

interface ApiToken {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const roles: { value: Role; label: string; description: string }[] = [
  { value: 'admin', label: 'Administrator', description: 'Full system access' },
  { value: 'approver', label: 'Approver', description: 'Can approve commits and deploy' },
  { value: 'editor', label: 'Editor', description: 'Can edit data and create commits' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' }
]

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({ email: '', name: '', role: 'editor' as Role })
  const [saving, setSaving] = useState(false)

  // API token dialog
  const [tokenDialogUser, setTokenDialogUser] = useState<User | null>(null)
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [newTokenName, setNewTokenName] = useState('')
  const [issuedToken, setIssuedToken] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)

  // Confirmation dialogs - Blueprint <Alert>, not native confirm()/alert():
  // some browsers silently suppress repeated native dialogs (e.g. after
  // "prevent this page from creating more dialogs"), which made the delete
  // button look like it did nothing.
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error('Failed to load users')
      const json = await res.json()
      setUsers(json.data || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const primaryRole = (user: User): Role => user.roles[0] ?? 'viewer'

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
    const date = new Date(dateString)
    return date.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const handleAddUser = () => {
    setSelectedUser(null)
    setFormData({ email: '', name: '', role: 'editor' })
    setDialogOpen(true)
  }

  const handleEditUser = (user: User) => {
    setSelectedUser(user)
    setFormData({ email: user.email, name: user.name ?? '', role: primaryRole(user) })
    setDialogOpen(true)
  }

  const handleSaveUser = async () => {
    setSaving(true)
    try {
      if (selectedUser) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedUser.id, role: formData.role })
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update user')
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formData.email, name: formData.name, role: formData.role })
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to invite user')
      }
      await fetchUsers()
      setDialogOpen(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (user: User) => {
    try {
      const newStatus: Status = user.status === 'active' ? 'inactive' : 'active'
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, status: newStatus })
      })
      if (!res.ok) throw new Error('Failed to update status')
      await fetchUsers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/users?id=${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete user')
      await fetchUsers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setDeleteTarget(null)
    }
  }

  const openTokenDialog = async (user: User) => {
    setTokenDialogUser(user)
    setNewTokenName('')
    setIssuedToken(null)
    setTokenLoading(true)
    try {
      const res = await fetch(`/api/users/${user.id}/tokens`)
      const json = await res.json()
      setTokens(json.data || [])
    } catch {
      setTokens([])
    } finally {
      setTokenLoading(false)
    }
  }

  const handleIssueToken = async () => {
    if (!tokenDialogUser || !newTokenName) return
    setTokenLoading(true)
    try {
      const res = await fetch(`/api/users/${tokenDialogUser.id}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to issue token')
      setIssuedToken(json.token)
      setNewTokenName('')
      const listRes = await fetch(`/api/users/${tokenDialogUser.id}/tokens`)
      setTokens((await listRes.json()).data || [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to issue token')
    } finally {
      setTokenLoading(false)
    }
  }

  const confirmRevokeToken = async () => {
    if (!tokenDialogUser || revokeTarget === null) return
    try {
      const res = await fetch(`/api/users/${tokenDialogUser.id}/tokens?tokenId=${revokeTarget}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to revoke token')
      const listRes = await fetch(`/api/users/${tokenDialogUser.id}/tokens`)
      setTokens((await listRes.json()).data || [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke token')
    } finally {
      setRevokeTarget(null)
    }
  }

  const activeUsers = users.filter(u => u.status === 'active').length
  const pendingUsers = users.filter(u => u.status === 'pending').length

  return (
    <>
      <Header title="User Management" breadcrumb={['Settings', 'Users']} />

      <div className="page-content">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Total Users</span>
            <span className="kpi-value">{users.length}</span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Active</span>
            <span className="kpi-value" style={{ color: 'var(--intent-success, #0f9960)' }}>{activeUsers}</span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Pending Invites</span>
            <span className="kpi-value" style={{ color: pendingUsers > 0 ? 'var(--intent-warning, #d9822b)' : undefined }}>
              {pendingUsers}
            </span>
          </div>
        </div>

        <Callout icon="info-sign" style={{ marginBottom: 16 }}>
          <strong>Role Permissions:</strong> Admin (full access) → Approver (approve & deploy) → Editor (edit & commit) → Viewer (read-only).
          Der erste Login legt automatisch einen Admin an. Neue Nutzer werden beim ersten OAuth-Login automatisch hier registriert.
        </Callout>

        <div className="section-header">
          <h2>Users</h2>
          <Button icon="add" intent="primary" onClick={handleAddUser}>Add User</Button>
        </div>

        {error && (
          <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>{error}</Callout>
        )}
        {actionError && (
          <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>{actionError}</span>
              <Button icon="cross" minimal small onClick={() => setActionError(null)} aria-label="Dismiss" />
            </div>
          </Callout>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : users.length === 0 ? (
          <NonIdealState icon="person" title="No users" description="No users have logged in or been invited yet." />
        ) : (
          <HTMLTable bordered striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created</th>
                <th style={{ width: 150 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--intent-primary, #137cbd)', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', fontSize: 12
                      }}>
                        {(user.name || user.email).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div>{user.name || '—'}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Tag intent={getRoleIntent(primaryRole(user))} minimal>
                      {roles.find(r => r.value === primaryRole(user))?.label}
                    </Tag>
                  </td>
                  <td>
                    <Tag intent={getStatusIntent(user.status)} minimal>{user.status}</Tag>
                  </td>
                  <td className="text-muted">{formatDate(user.last_login_at)}</td>
                  <td className="text-muted">{formatDate(user.created_at)}</td>
                  <td>
                    <Button small minimal icon="edit" title="Edit role" onClick={() => handleEditUser(user)} />
                    <Button
                      small minimal icon={user.status === 'active' ? 'disable' : 'tick'}
                      intent={user.status === 'active' ? 'warning' : 'success'}
                      title={user.status === 'active' ? 'Deactivate' : 'Activate'}
                      onClick={() => handleToggleStatus(user)}
                    />
                    <Button small minimal icon="key" title="API Tokens" onClick={() => openTokenDialog(user)} />
                    <Button small minimal icon="trash" intent="danger" title="Delete" onClick={() => setDeleteTarget(user)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </div>

      {/* Add/Edit User Dialog */}
      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={selectedUser ? 'Edit User Role' : 'Invite New User'}
        icon="person"
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Email" labelFor="email" labelInfo="(required)">
            <InputGroup
              id="email" type="email" placeholder="user@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={!!selectedUser}
            />
          </FormGroup>

          {!selectedUser && (
            <FormGroup label="Full Name" labelFor="name">
              <InputGroup
                id="name" placeholder="Max Mustermann"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </FormGroup>
          )}

          <FormGroup label="Role" labelFor="role">
            <HTMLSelect
              id="role" value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
              fill
            >
              {roles.map(role => (
                <option key={role.value} value={role.value}>{role.label} - {role.description}</option>
              ))}
            </HTMLSelect>
          </FormGroup>

          {!selectedUser && (
            <Callout icon="info-sign">
              Der Nutzer wird mit Status "pending" angelegt und automatisch aktiviert, sobald er sich zum ersten Mal einloggt.
            </Callout>
          )}
        </div>

        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              intent="primary" loading={saving}
              onClick={handleSaveUser}
              disabled={!selectedUser && (!formData.email || !formData.name)}
            >
              {selectedUser ? 'Save Changes' : 'Add User'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* API Tokens Dialog */}
      <Dialog
        isOpen={!!tokenDialogUser}
        onClose={() => setTokenDialogUser(null)}
        title={`API Tokens: ${tokenDialogUser?.email ?? ''}`}
        icon="key"
        style={{ width: 550 }}
      >
        <div className="bp5-dialog-body">
          {issuedToken && (
            <Callout intent="warning" icon="warning-sign" style={{ marginBottom: 16 }}>
              <strong>Token wurde erstellt - jetzt kopieren, er wird nicht wieder angezeigt:</strong>
              <div style={{
                fontFamily: 'monospace', fontSize: 12, marginTop: 8, padding: 8,
                background: 'var(--card-bg-secondary, #f5f8fa)', borderRadius: 4, wordBreak: 'break-all'
              }}>
                {issuedToken}
              </div>
            </Callout>
          )}

          <FormGroup label="Neuer Token" labelFor="token-name" inline>
            <div style={{ display: 'flex', gap: 8 }}>
              <InputGroup
                id="token-name" placeholder="z.B. CI Pipeline"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
              />
              <Button intent="primary" disabled={!newTokenName} loading={tokenLoading} onClick={handleIssueToken}>
                Generate
              </Button>
            </div>
          </FormGroup>

          <h4 style={{ marginTop: 20, marginBottom: 8, fontSize: 12 }}>Bestehende Tokens</h4>
          {tokens.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 12 }}>Noch keine Tokens ausgestellt.</div>
          ) : (
            <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td><code>{t.token_prefix}…</code></td>
                    <td>
                      {t.scopes.map(s => (
                        <Tag key={s} minimal style={{ marginRight: 4, fontSize: 10 }}>{s}</Tag>
                      ))}
                    </td>
                    <td>
                      {t.revoked_at ? (
                        <Tag intent="danger" minimal>revoked</Tag>
                      ) : (
                        <Tag intent="success" minimal>active</Tag>
                      )}
                    </td>
                    <td>
                      {!t.revoked_at && (
                        <Button small minimal icon="cross" intent="danger" onClick={() => setRevokeTarget(t.id)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          )}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setTokenDialogUser(null)}>Close</Button>
          </div>
        </div>
      </Dialog>

      {/* Delete user confirmation */}
      <Alert
        isOpen={!!deleteTarget}
        onConfirm={confirmDeleteUser}
        onCancel={() => setDeleteTarget(null)}
        cancelButtonText="Cancel"
        confirmButtonText="Delete"
        intent="danger"
        icon="trash"
      >
        <p>
          <strong>{deleteTarget?.email}</strong> wirklich löschen? Zugehörige API-Tokens werden mit entfernt.
        </p>
      </Alert>

      {/* Revoke token confirmation */}
      <Alert
        isOpen={revokeTarget !== null}
        onConfirm={confirmRevokeToken}
        onCancel={() => setRevokeTarget(null)}
        cancelButtonText="Cancel"
        confirmButtonText="Revoke"
        intent="danger"
        icon="disable"
      >
        <p>Diesen Token wirklich widerrufen? Diese Aktion kann nicht rückgängig gemacht werden.</p>
      </Alert>
    </>
  )
}
