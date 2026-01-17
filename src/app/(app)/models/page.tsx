'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Button, 
  Card, 
  Icon, 
  Tag, 
  Dialog, 
  FormGroup, 
  InputGroup,
  TextArea,
  Intent,
  Spinner,
  NonIdealState,
  Menu,
  MenuItem,
  MenuDivider
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

// Custom Dropdown Menu Component to fix Blueprint Popover positioning issues
function ModelCardMenu({ 
  model, 
  onEdit, 
  onActivate, 
  onDeactivate, 
  onDelete 
}: { 
  model: { id: number; code: string; status: string }
  onEdit: () => void
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div style={{ position: 'relative' }}>
      <Button 
        ref={buttonRef}
        minimal 
        small 
        icon="more" 
        onClick={() => setIsOpen(!isOpen)}
        active={isOpen}
      />
      {isOpen && (
        <div 
          ref={menuRef}
          style={{ 
            position: 'absolute', 
            top: '100%', 
            right: 0, 
            zIndex: 100,
            marginTop: 4
          }}
        >
          <Menu>
            <MenuItem icon="edit" text="Edit" onClick={() => { onEdit(); setIsOpen(false); }} />
            {model.status === 'draft' && (
              <MenuItem icon="tick" text="Activate" intent="success" onClick={() => { onActivate(); setIsOpen(false); }} />
            )}
            {model.status === 'active' && (
              <MenuItem icon="disable" text="Deactivate" intent="warning" onClick={() => { onDeactivate(); setIsOpen(false); }} />
            )}
            <MenuDivider />
            <MenuItem icon="duplicate" text="Duplicate" onClick={() => { alert(`Duplicate model ${model.code} - Coming soon!`); setIsOpen(false); }} />
            <MenuItem icon="export" text="Export" onClick={() => { alert(`Export model ${model.code} - Coming soon!`); setIsOpen(false); }} />
            <MenuDivider />
            <MenuItem 
              icon="trash" 
              text="Delete" 
              intent="danger" 
              onClick={() => { onDelete(); setIsOpen(false); }} 
            />
          </Menu>
        </div>
      )}
    </div>
  )
}

interface Model {
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
  entity_count: number
  record_count?: number
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newModel, setNewModel] = useState({ code: '', name: '', description: '' })
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editModel, setEditModel] = useState<Model | null>(null)
  const router = useRouter()

  // Fetch models from API
  const fetchModels = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/models')
      if (!res.ok) {
        throw new Error(`Error: ${res.status}`)
      }
      const json = await res.json()
      setModels(json.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModels()
  }, [])

  const handleCreate = async () => {
    try {
      setIsCreating(true)
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newModel.code.toUpperCase().replace(/\s+/g, '_'),
          name: newModel.name,
          description: newModel.description
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create model')
      }
      
      setNewModel({ code: '', name: '', description: '' })
      setIsCreateOpen(false)
      fetchModels() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create model')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenEdit = (model: Model) => {
    setEditModel(model)
    setIsEditOpen(true)
  }

  const handleEditModel = async () => {
    if (!editModel) return
    try {
      setIsEditing(true)
      const res = await fetch(`/api/models/${editModel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editModel.name,
          description: editModel.description
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update model')
      }
      
      setEditModel(null)
      setIsEditOpen(false)
      fetchModels() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update model')
    } finally {
      setIsEditing(false)
    }
  }

  const handleActivateModel = async (modelId: number) => {
    try {
      const res = await fetch(`/api/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to activate model')
      }
      
      fetchModels() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to activate model')
    }
  }

  const handleDeleteModel = async (modelId: number, modelCode: string) => {
    if (!confirm(`Are you sure you want to delete model "${modelCode}"? This cannot be undone.`)) {
      return
    }
    
    try {
      const res = await fetch(`/api/models/${modelId}`, {
        method: 'DELETE'
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete model')
      }
      
      fetchModels() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete model')
    }
  }

  const handleDeactivateModel = async (modelId: number) => {
    try {
      const res = await fetch(`/api/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to deactivate model')
      }
      
      fetchModels() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate model')
    }
  }

  const getStatusIntent = (status: Model['status']): Intent => {
    switch (status) {
      case 'active': return 'success'
      case 'draft': return 'warning'
      case 'deprecated': return 'none'
      default: return 'none'
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return (
      <>
        <Header title="Models" breadcrumb={['Model Design', 'Models']} />
        <div className="page-content" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spinner size={40} />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Header title="Models" breadcrumb={['Model Design', 'Models']} />
        <div className="page-content">
          <NonIdealState
            icon="error"
            title="Failed to load models"
            description={error}
            action={<Button icon="refresh" onClick={fetchModels}>Retry</Button>}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <Header title="Models" breadcrumb={['Model Design', 'Models']} />
      
      <div className="page-content">
        <div className="section-header">
          <h2>Data Models</h2>
          <Button 
            icon="add" 
            intent="primary"
            onClick={() => setIsCreateOpen(true)}
          >
            New Model
          </Button>
        </div>

        {models.length === 0 ? (
          <NonIdealState
            icon="cube"
            title="No models yet"
            description="Create your first data model to get started"
            action={<Button icon="add" intent="primary" onClick={() => setIsCreateOpen(true)}>Create Model</Button>}
          />
        ) : (
          <div className="card-grid">
            {models.map((model) => (
              <Card key={model.id} className="model-card" elevation={0}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ 
                      width: 32, 
                      height: 32, 
                      borderRadius: 3, 
                      background: 'rgba(19, 124, 189, 0.1)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center' 
                    }}>
                      <Icon icon="cube" size={16} color="#137cbd" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{model.code}</div>
                      <Tag minimal intent={getStatusIntent(model.status)} style={{ marginTop: 2 }}>
                        {model.status}
                      </Tag>
                    </div>
                  </div>
                  <ModelCardMenu
                    model={model}
                    onEdit={() => handleOpenEdit(model)}
                    onActivate={() => handleActivateModel(model.id)}
                    onDeactivate={() => handleDeactivateModel(model.id)}
                    onDelete={() => handleDeleteModel(model.id, model.code)}
                  />
                </div>

                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4 }}>{model.name}</div>
                <p className="text-muted" style={{ fontSize: 11, marginBottom: 12, minHeight: 32 }}>
                  {model.description || 'No description'}
                </p>

                <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 300 }}>{model.entity_count}</div>
                    <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Entities</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 300 }}>{(model.record_count || 0).toLocaleString('de-DE')}</div>
                    <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Records</div>
                  </div>
                </div>

                <div className="card-footer" style={{ display: 'flex', gap: 6, paddingTop: 10 }}>
                  <Button 
                    small 
                    icon="th" 
                    text="Entities" 
                    onClick={() => router.push('/entities')}
                  />
                  <Button 
                    small 
                    icon="database" 
                    text="Data" 
                    onClick={() => router.push('/data')}
                  />
                  {model.status === 'active' && (
                    <Button small icon="play" intent="success" text="Deploy" onClick={() => router.push('/deploy')} />
                  )}
                  {model.status === 'draft' && (
                    <Button small icon="tick" intent="primary" text="Activate" onClick={() => handleActivateModel(model.id)} />
                  )}
                </div>

                <div className="text-muted" style={{ marginTop: 10, fontSize: 10 }}>
                  Created: {formatDate(model.created_at)} by {model.created_by}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Model Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Model"
        icon="cube"
        style={{ width: 420 }}
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Model Code" labelFor="model-code" labelInfo="(required)" helperText="Unique identifier (e.g., CRM, PRODUCTS)">
            <InputGroup
              id="model-code"
              placeholder="e.g., CRM"
              value={newModel.code}
              onChange={(e) => setNewModel({ ...newModel, code: e.target.value.toUpperCase() })}
            />
          </FormGroup>
          <FormGroup label="Model Name" labelFor="model-name" labelInfo="(required)">
            <InputGroup
              id="model-name"
              placeholder="e.g., Customer Relationship Management"
              value={newModel.name}
              onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Description" labelFor="model-desc">
            <TextArea
              id="model-desc"
              placeholder="Brief description of this data model..."
              fill
              autoResize
              value={newModel.description}
              onChange={(e) => setNewModel({ ...newModel, description: e.target.value })}
            />
          </FormGroup>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button small onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
            <Button 
              small
              intent="primary" 
              onClick={handleCreate}
              disabled={!newModel.code.trim() || !newModel.name.trim() || isCreating}
              loading={isCreating}
            >
              Create Model
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Edit Model Dialog */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditModel(null); }}
        title="Edit Model"
        icon="edit"
        style={{ width: 420 }}
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Model Code" labelFor="edit-model-code" helperText="Code cannot be changed">
            <InputGroup
              id="edit-model-code"
              value={editModel?.code || ''}
              disabled
            />
          </FormGroup>
          <FormGroup label="Model Name" labelFor="edit-model-name" labelInfo="(required)">
            <InputGroup
              id="edit-model-name"
              placeholder="e.g., Customer Relationship Management"
              value={editModel?.name || ''}
              onChange={(e) => editModel && setEditModel({ ...editModel, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Description" labelFor="edit-model-desc">
            <TextArea
              id="edit-model-desc"
              placeholder="Brief description of this data model..."
              fill
              autoResize
              value={editModel?.description || ''}
              onChange={(e) => editModel && setEditModel({ ...editModel, description: e.target.value })}
            />
          </FormGroup>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button small onClick={() => { setIsEditOpen(false); setEditModel(null); }} disabled={isEditing}>Cancel</Button>
            <Button 
              small
              intent="primary" 
              onClick={handleEditModel}
              disabled={!editModel?.name?.trim() || isEditing}
              loading={isEditing}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
