'use client'

import { useState } from 'react'
import {
  Button,
  HTMLTable,
  Tag,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Switch,
  Callout
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'approver' | 'editor' | 'viewer'
  status: 'active' | 'inactive' | 'pending'
  lastLogin?: string
  createdAt: string
}

const mockUsers: User[] = [
  {
    id: 'user-001',
    email: 'admin@example.com',
    name: 'System Admin',
    role: 'admin',
    status: 'active',
    lastLogin: '2024-01-08T11:30:00Z',
    createdAt: '2023-01-01T00:00:00Z'
  },
  {
    id: 'user-002',
    email: 'approver@example.com',
    name: 'Max Mustermann',
    role: 'approver',
    status: 'active',
    lastLogin: '2024-01-08T09:15:00Z',
    createdAt: '2023-06-15T00:00:00Z'
  },
  {
    id: 'user-003',
    email: 'editor@example.com',
    name: 'Anna Schmidt',
    role: 'editor',
    status: 'active',
    lastLogin: '2024-01-07T16:45:00Z',
    createdAt: '2023-09-01T00:00:00Z'
  },
  {
    id: 'user-004',
    email: 'viewer@example.com',
    name: 'Peter Meyer',
    role: 'viewer',
    status: 'inactive',
    lastLogin: '2023-12-15T10:00:00Z',
    createdAt: '2023-10-01T00:00:00Z'
  },
  {
    id: 'user-005',
    email: 'new.user@example.com',
    name: 'Neue Benutzerin',
    role: 'editor',
    status: 'pending',
    createdAt: '2024-01-05T00:00:00Z'
  }
]

const roles = [
  { value: 'admin', label: 'Administrator', description: 'Full system access' },
  { value: 'approver', label: 'Approver', description: 'Can approve commits and deploy' },
  { value: 'editor', label: 'Editor', description: 'Can edit data and create commits' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' }
]

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>(mockUsers)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    role: 'editor' as User['role'],
    sendInvite: true
  })

  const getRoleIntent = (role: User['role']) => {
    switch (role) {
      case 'admin': return 'danger'
      case 'approver': return 'warning'
      case 'editor': return 'primary'
      case 'viewer': return 'none'
    }
  }

  const getStatusIntent = (status: User['status']) => {
    switch (status) {
      case 'active': return 'success'
      case 'inactive': return 'none'
      case 'pending': return 'warning'
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleAddUser = () => {
    setSelectedUser(null)
    setFormData({
      email: '',
      name: '',
      role: 'editor',
      sendInvite: true
    })
    setDialogOpen(true)
  }

  const handleEditUser = (user: User) => {
    setSelectedUser(user)
    setFormData({
      email: user.email,
      name: user.name,
      role: user.role,
      sendInvite: false
    })
    setDialogOpen(true)
  }

  const handleSaveUser = () => {
    if (selectedUser) {
      // Update existing user
      setUsers(users.map(u => 
        u.id === selectedUser.id 
          ? { ...u, ...formData }
          : u
      ))
    } else {
      // Add new user
      const newUser: User = {
        id: `user-${Date.now()}`,
        email: formData.email,
        name: formData.name,
        role: formData.role,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      setUsers([...users, newUser])
    }
    setDialogOpen(false)
  }

  const handleDeactivateUser = (user: User) => {
    setUsers(users.map(u => 
      u.id === user.id 
        ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' }
        : u
    ))
  }

  const activeUsers = users.filter(u => u.status === 'active').length
  const pendingUsers = users.filter(u => u.status === 'pending').length

  return (
    <>
      <Header title="User Management" breadcrumb={['Settings', 'Users']} />

      <div className="page-content">
        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Total Users</span>
            <span className="kpi-value">{users.length}</span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Active</span>
            <span className="kpi-value" style={{ color: 'var(--intent-success, #0f9960)' }}>
              {activeUsers}
            </span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Pending Invites</span>
            <span className="kpi-value" style={{ color: pendingUsers > 0 ? 'var(--intent-warning, #d9822b)' : undefined }}>
              {pendingUsers}
            </span>
          </div>
        </div>

        {/* Role Permissions Info */}
        <Callout icon="info-sign" style={{ marginBottom: 16 }}>
          <strong>Role Permissions:</strong> Admin (full access) → Approver (approve & deploy) → Editor (edit & commit) → Viewer (read-only)
        </Callout>

        {/* Header */}
        <div className="section-header">
          <h2>Users</h2>
          <Button icon="add" intent="primary" onClick={handleAddUser}>
            Add User
          </Button>
        </div>

        {/* Users Table */}
        <HTMLTable bordered striped style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Created</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--intent-primary, #137cbd)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: 12
                    }}>
                      {user.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div>{user.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{user.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <Tag intent={getRoleIntent(user.role)} minimal>
                    {roles.find(r => r.value === user.role)?.label}
                  </Tag>
                </td>
                <td>
                  <Tag intent={getStatusIntent(user.status)} minimal>
                    {user.status}
                  </Tag>
                </td>
                <td className="text-muted">
                  {user.lastLogin ? formatDate(user.lastLogin) : 'Never'}
                </td>
                <td className="text-muted">
                  {formatDate(user.createdAt)}
                </td>
                <td>
                  <Button 
                    small 
                    minimal 
                    icon="edit" 
                    onClick={() => handleEditUser(user)}
                  />
                  <Button 
                    small 
                    minimal 
                    icon={user.status === 'active' ? 'disable' : 'tick'}
                    intent={user.status === 'active' ? 'warning' : 'success'}
                    onClick={() => handleDeactivateUser(user)}
                  />
                  {user.status === 'pending' && (
                    <Button 
                      small 
                      minimal 
                      icon="envelope" 
                      title="Resend Invite"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </div>

      {/* Add/Edit User Dialog */}
      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={selectedUser ? 'Edit User' : 'Add New User'}
        icon="person"
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Email" labelFor="email" labelInfo="(required)">
            <InputGroup
              id="email"
              type="email"
              placeholder="user@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={!!selectedUser}
            />
          </FormGroup>

          <FormGroup label="Full Name" labelFor="name" labelInfo="(required)">
            <InputGroup
              id="name"
              placeholder="Max Mustermann"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </FormGroup>

          <FormGroup label="Role" labelFor="role">
            <HTMLSelect
              id="role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as User['role'] })}
              fill
            >
              {roles.map(role => (
                <option key={role.value} value={role.value}>
                  {role.label} - {role.description}
                </option>
              ))}
            </HTMLSelect>
          </FormGroup>

          {!selectedUser && (
            <Switch
              label="Send invitation email"
              checked={formData.sendInvite}
              onChange={(e) => setFormData({ ...formData, sendInvite: e.target.checked })}
            />
          )}
        </div>

        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button 
              intent="primary" 
              onClick={handleSaveUser}
              disabled={!formData.email || !formData.name}
            >
              {selectedUser ? 'Save Changes' : 'Add User'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
