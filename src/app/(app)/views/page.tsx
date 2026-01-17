'use client'

import { useEffect, useState, useCallback } from 'react'
import { 
  Button, 
  Card, 
  Tag, 
  Icon, 
  Dialog, 
  FormGroup, 
  InputGroup, 
  TextArea,
  HTMLSelect,
  Switch,
  Callout,
  Spinner,
  NonIdealState,
  Tabs,
  Tab
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'
import { SectionHeader } from '@/components/ui/SectionHeader'

interface Entity {
  id: number
  code: string
  name: string
}

interface EntityView {
  id: number
  entity_id: number
  entity_code: string
  entity_name: string
  code: string
  name: string
  description: string | null
  view_type: 'scd1' | 'scd2' | 'custom'
  custom_sql: string | null
  column_config: string | null
  filter_condition: string | null
  is_default: boolean
  is_deployed: boolean
  last_deployed_at: string | null
  created_at: string
  created_by: string
}

export default function ViewsPage() {
  const [views, setViews] = useState<EntityView[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEntity, setSelectedEntity] = useState<number | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingView, setEditingView] = useState<EntityView | null>(null)
  const [deploying, setDeploying] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    entity_id: 0,
    code: '',
    name: '',
    description: '',
    view_type: 'scd1' as 'scd1' | 'scd2' | 'custom',
    custom_sql: '',
    filter_condition: '',
    is_default: false
  })
  
  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch('/api/entities')
      const data = await res.json()
      setEntities(data.data || [])
    } catch (err) {
      console.error('Failed to fetch entities:', err)
    }
  }, [])
  
  const fetchViews = useCallback(async () => {
    try {
      setLoading(true)
      const url = selectedEntity 
        ? `/api/views?entity_id=${selectedEntity}` 
        : '/api/views'
      const res = await fetch(url)
      const data = await res.json()
      setViews(data.views || [])
    } catch (err) {
      console.error('Failed to fetch views:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedEntity])
  
  useEffect(() => {
    fetchEntities()
  }, [fetchEntities])
  
  useEffect(() => {
    fetchViews()
  }, [fetchViews])
  
  const handleCreateView = () => {
    setEditingView(null)
    const entityId = selectedEntity || (entities[0]?.id || 0)
    const entity = entities.find(e => e.id === entityId)
    const entityCode = entity?.code?.toLowerCase() || 'entity'
    const timestamp = Date.now().toString(36)
    const defaultCode = `v_${entityCode}_${timestamp}`
    
    setFormData({
      entity_id: entityId,
      code: defaultCode,
      name: '',
      description: '',
      view_type: 'scd1',
      custom_sql: '',
      filter_condition: '',
      is_default: false
    })
    setIsDialogOpen(true)
  }
  
  const handleEditView = (view: EntityView) => {
    setEditingView(view)
    setFormData({
      entity_id: view.entity_id,
      code: view.code,
      name: view.name,
      description: view.description || '',
      view_type: view.view_type,
      custom_sql: view.custom_sql || '',
      filter_condition: view.filter_condition || '',
      is_default: view.is_default
    })
    setIsDialogOpen(true)
  }
  
  const handleSaveView = async () => {
    try {
      const method = editingView ? 'PATCH' : 'POST'
      const body = editingView 
        ? { id: editingView.id, ...formData }
        : formData
      
      const res = await fetch('/api/views', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save view')
      }
      
      setIsDialogOpen(false)
      fetchViews()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save view')
    }
  }
  
  const handleDeleteView = async (view: EntityView) => {
    if (!confirm(`Delete view "${view.name}"? This cannot be undone.`)) return
    
    try {
      const res = await fetch(`/api/views?id=${view.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete view')
      fetchViews()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete view')
    }
  }
  
  const handleDeployView = async (view: EntityView) => {
    try {
      setDeploying(true)
      const res = await fetch('/api/views/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_ids: [view.id] })
      })
      
      const data = await res.json()
      
      if (!res.ok) throw new Error(data.error || 'Failed to deploy view')
      
      if (data.views_success === 1) {
        fetchViews()
      } else {
        throw new Error(data.results[0]?.error || 'Deployment failed')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deploy view')
    } finally {
      setDeploying(false)
    }
  }
  
  const handleDeployAll = async () => {
    const undeployed = views.filter(v => !v.is_deployed)
    if (undeployed.length === 0) {
      alert('All views are already deployed')
      return
    }
    
    if (!confirm(`Deploy ${undeployed.length} view(s)?`)) return
    
    try {
      setDeploying(true)
      const res = await fetch('/api/views/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_ids: undeployed.map(v => v.id) })
      })
      
      const data = await res.json()
      
      if (data.views_success > 0) {
        alert(data.message)
        fetchViews()
      } else {
        throw new Error('All deployments failed')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deploy views')
    } finally {
      setDeploying(false)
    }
  }
  
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  const getViewTypeIntent = (type: string) => {
    switch (type) {
      case 'scd1': return 'success'
      case 'scd2': return 'primary'
      case 'custom': return 'warning'
      default: return 'none'
    }
  }
  
  const getViewTypeLabel = (type: string) => {
    switch (type) {
      case 'scd1': return 'Aktuell (SCD1)'
      case 'scd2': return 'Historie (SCD2)'
      case 'custom': return 'Custom SQL'
      default: return type
    }
  }
  
  // Group views by entity
  const viewsByEntity = views.reduce((acc, view) => {
    const key = view.entity_id
    if (!acc[key]) {
      acc[key] = {
        entity: { id: view.entity_id, code: view.entity_code, name: view.entity_name },
        views: []
      }
    }
    acc[key].views.push(view)
    return acc
  }, {} as Record<number, { entity: Entity; views: EntityView[] }>)
  
  const totalViews = views.length
  const deployedViews = views.filter(v => v.is_deployed).length
  const pendingViews = totalViews - deployedViews
  
  return (
    <PageLayout 
      title="Views" 
      breadcrumb={['Model Design', 'Views']}
    >
      <KpiGrid>
        <KpiCard label="Views gesamt" value={totalViews} />
        <KpiCard label="Deployed" value={deployedViews} />
        <KpiCard label="Pending" value={pendingViews} />
        <KpiCard label="Entities" value={Object.keys(viewsByEntity).length} />
      </KpiGrid>
      
      {/* Section Header with Filter and Actions */}
      <SectionHeader 
        title="View Definitions"
        actions={
          <>
            <HTMLSelect 
              value={selectedEntity || ''} 
              onChange={e => setSelectedEntity(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Alle Entities</option>
              {entities.map(entity => (
                <option key={entity.id} value={entity.id}>{entity.name}</option>
              ))}
            </HTMLSelect>
            {pendingViews > 0 && (
              <Button 
                icon="cloud-upload" 
                intent="success"
                onClick={handleDeployAll}
                loading={deploying}
              >
                Alle deployen ({pendingViews})
              </Button>
            )}
            <Button 
              icon="add" 
              intent="primary" 
              onClick={handleCreateView}
            >
              Neue View
            </Button>
          </>
        }
      />
      
      {loading ? (
        <Spinner />
      ) : views.length === 0 ? (
        <NonIdealState
          icon="eye-off"
          title="Keine Views"
          description="Es wurden noch keine Views konfiguriert."
          action={
            <Button intent="primary" icon="add" onClick={handleCreateView}>
              View erstellen
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {Object.values(viewsByEntity).map(({ entity, views: entityViews }) => (
            <Card key={entity.id} elevation={1}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <Icon icon="database" size={20} />
                <h3 style={{ margin: 0 }}>{entity.name}</h3>
                <Tag minimal>{entity.code}</Tag>
                <Tag intent="primary">{entityViews.length} View(s)</Tag>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {entityViews.map(view => (
                  <Card 
                    key={view.id} 
                    elevation={0}
                    style={{ 
                      backgroundColor: view.is_deployed ? '#f0f8f0' : '#fff8e6',
                      border: '1px solid #ddd'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <strong>{view.name}</strong>
                          {view.is_default && <Tag intent="primary" minimal>Default</Tag>}
                          <Tag intent={getViewTypeIntent(view.view_type)} minimal>
                            {getViewTypeLabel(view.view_type)}
                          </Tag>
                          {view.is_deployed ? (
                            <Tag intent="success" icon="tick">Deployed</Tag>
                          ) : (
                            <Tag intent="warning" icon="cloud-upload">Pending</Tag>
                          )}
                        </div>
                        <code style={{ fontSize: '12px', color: '#666' }}>mds_view.{view.code}</code>
                        {view.description && (
                          <p style={{ margin: '8px 0 0', color: '#666', fontSize: '14px' }}>
                            {view.description}
                          </p>
                        )}
                        {view.filter_condition && (
                          <p style={{ margin: '4px 0 0', color: '#888', fontSize: '12px' }}>
                            Filter: <code>{view.filter_condition}</code>
                          </p>
                        )}
                        {view.last_deployed_at && (
                          <p style={{ margin: '4px 0 0', color: '#888', fontSize: '12px' }}>
                            Zuletzt deployed: {formatDate(view.last_deployed_at)}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {!view.is_deployed && (
                          <Button 
                            small 
                            icon="cloud-upload" 
                            intent="success"
                            onClick={() => handleDeployView(view)}
                            loading={deploying}
                          >
                            Deploy
                          </Button>
                        )}
                        <Button small icon="edit" onClick={() => handleEditView(view)}>
                          Bearbeiten
                        </Button>
                        <Button 
                          small 
                          icon="trash" 
                          intent="danger" 
                          minimal
                          onClick={() => handleDeleteView(view)}
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      
      {/* Create/Edit Dialog */}
      <Dialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={editingView ? 'View bearbeiten' : 'Neue View erstellen'}
        style={{ width: '600px' }}
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Entity" labelFor="entity">
            <HTMLSelect
              id="entity"
              fill
              value={formData.entity_id}
              onChange={e => setFormData({ ...formData, entity_id: parseInt(e.target.value) })}
              disabled={!!editingView}
            >
              <option value="">Entity auswählen...</option>
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </HTMLSelect>
          </FormGroup>
          
          <FormGroup label="Code" labelFor="code" helperText="Eindeutiger technischer Name (z.B. v_customer_active)">
            <InputGroup
              id="code"
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value })}
              placeholder="v_customer_active"
              disabled={!!editingView}
            />
          </FormGroup>
          
          <FormGroup label="Name" labelFor="name">
            <InputGroup
              id="name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Aktive Kunden"
            />
          </FormGroup>
          
          <FormGroup label="Beschreibung" labelFor="description">
            <TextArea
              id="description"
              fill
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optionale Beschreibung..."
            />
          </FormGroup>
          
          <FormGroup label="View-Typ" labelFor="view_type">
            <HTMLSelect
              id="view_type"
              fill
              value={formData.view_type}
              onChange={e => setFormData({ 
                ...formData, 
                view_type: e.target.value as 'scd1' | 'scd2' | 'custom' 
              })}
            >
              <option value="scd1">Aktuell (SCD1) - Nur letztgültige Daten</option>
              <option value="scd2">Historie (SCD2) - Alle Versionen</option>
              <option value="custom">Custom SQL - Eigene Query</option>
            </HTMLSelect>
          </FormGroup>
          
          {formData.view_type === 'custom' && (
            <FormGroup 
              label="Custom SQL" 
              labelFor="custom_sql"
              helperText="Vollständige SELECT-Query ohne CREATE VIEW"
            >
              <TextArea
                id="custom_sql"
                fill
                rows={8}
                value={formData.custom_sql}
                onChange={e => setFormData({ ...formData, custom_sql: e.target.value })}
                placeholder="SELECT 
    customer_id,
    name,
    email,
    CASE WHEN is_active = 1 THEN 'Aktiv' ELSE 'Inaktiv' END as status
FROM mds_master.customer
WHERE is_current = 1"
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </FormGroup>
          )}
          
          {formData.view_type !== 'custom' && (
            <FormGroup 
              label="Filter-Bedingung" 
              labelFor="filter_condition"
              helperText="Optionale WHERE-Bedingung (ohne WHERE)"
            >
              <InputGroup
                id="filter_condition"
                value={formData.filter_condition}
                onChange={e => setFormData({ ...formData, filter_condition: e.target.value })}
                placeholder="is_active = 1"
              />
            </FormGroup>
          )}
          
          <Switch
            label="Als Default-View für diese Entity setzen"
            checked={formData.is_default}
            onChange={e => setFormData({ ...formData, is_default: e.currentTarget.checked })}
          />
          
          <Callout intent="primary" icon="info-sign" style={{ marginTop: '16px' }}>
            <strong>View-Typen:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
              <li><strong>SCD1:</strong> Gibt nur die aktuell gültigen Daten zurück (is_current = 1)</li>
              <li><strong>SCD2:</strong> Gibt die komplette Historie aller Änderungen zurück</li>
              <li><strong>Custom:</strong> Erlaubt beliebige SQL-Transformationen</li>
            </ul>
          </Callout>
        </div>
        
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setIsDialogOpen(false)}>Abbrechen</Button>
            <Button 
              intent="primary" 
              onClick={handleSaveView}
              disabled={!formData.entity_id || !formData.code || !formData.name}
            >
              {editingView ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  )
}
