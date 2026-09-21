'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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
  ProgressBar,
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
  const [deployingIds, setDeployingIds] = useState<Set<number>>(new Set())
  const deploying = deployingIds.size > 0
  const [deployLog, setDeployLog] = useState<{
    status: 'running' | 'completed' | 'failed'
    logs: string[]
    progress: number
  } | null>(null)
  const deployLogRef = useRef<HTMLPreElement>(null)
  
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
  
  // Deploys/redeploys the given views and streams the server's step log
  // (SSE from POST /api/views/deploy?stream=1) into the panel at the top of
  // the page, the same way the Jobs page shows a running deploy.
  const runViewDeploy = async (viewIds: number[]) => {
    setDeployingIds(new Set(viewIds))
    setDeployLog({ status: 'running', logs: ['📡 Verbinde mit Log-Stream...'], progress: 0 })

    const append = (line: string) =>
      setDeployLog(prev => prev && { ...prev, logs: [...prev.logs, line] })

    let finalStatus: 'completed' | 'failed' = 'failed'
    try {
      const res = await fetch('/api/views/deploy?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_ids: viewIds })
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Deployment fehlgeschlagen (HTTP ${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const dataLine = frame.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          const evt = JSON.parse(dataLine.slice(6))
          if (evt.type === 'log') {
            append(evt.message)
          } else if (evt.type === 'progress') {
            setDeployLog(prev => prev && { ...prev, progress: evt.value })
          } else if (evt.type === 'result') {
            finalStatus = evt.views_failed === 0 ? 'completed' : 'failed'
          } else if (evt.type === 'error') {
            append(`❌ Fehler: ${evt.error}`)
          }
        }
      }
    } catch (err) {
      append(`❌ ${err instanceof Error ? err.message : 'Deployment fehlgeschlagen'}`)
    } finally {
      setDeployLog(prev => prev && { ...prev, status: finalStatus, progress: 100 })
      setDeployingIds(new Set())
      fetchViews()
    }
  }

  const handleDeployView = (view: EntityView) => runViewDeploy([view.id])

  const handleDeployAll = () => {
    const undeployed = views.filter(v => !v.is_deployed)
    if (undeployed.length === 0) return
    if (!confirm(`Deploy ${undeployed.length} view(s)?`)) return
    runViewDeploy(undeployed.map(v => v.id))
  }

  const handleRedeployAll = () => {
    const deployed = views.filter(v => v.is_deployed)
    if (deployed.length === 0) return
    if (!confirm(`${deployed.length} deployte View(s) neu erstellen? Die Views werden kurz gelöscht und aus der aktuellen Definition neu angelegt.`)) return
    runViewDeploy(deployed.map(v => v.id))
  }

  // Keep the log panel scrolled to the newest line while a deploy is running.
  useEffect(() => {
    const el = deployLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [deployLog?.logs.length])

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

      {/* Live deploy log - same panel as the Jobs page's streaming deploy */}
      {deployLog && (
        <Callout
          intent={deployLog.status === 'failed' ? 'danger' : deployLog.status === 'completed' ? 'success' : 'primary'}
          icon={deployLog.status === 'failed' ? 'error' : deployLog.status === 'completed' ? 'tick-circle' : 'cloud-upload'}
          title={deployLog.status === 'running' ? 'View-Deployment läuft...' : deployLog.status === 'completed' ? 'View-Deployment erfolgreich!' : 'View-Deployment fehlgeschlagen'}
          style={{ marginBottom: 16, position: 'relative' }}
        >
          {deployLog.status !== 'running' && (
            <Button
              small
              minimal
              icon="cross"
              onClick={() => setDeployLog(null)}
              style={{ position: 'absolute', top: 10, right: 10 }}
            />
          )}
          <ProgressBar
            value={deployLog.progress / 100}
            intent={deployLog.status === 'failed' ? 'danger' : deployLog.status === 'completed' ? 'success' : 'primary'}
            animate={deployLog.status === 'running'}
            stripes={deployLog.status === 'running'}
          />
          <pre
            ref={deployLogRef}
            style={{
              marginTop: 12,
              background: 'var(--dark-gray5)',
              padding: 12,
              borderRadius: 4,
              maxHeight: 280,
              overflow: 'auto',
              fontSize: 11,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {deployLog.logs.join('\n')}
          </pre>
        </Callout>
      )}
      
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
                disabled={deploying}
              >
                Alle deployen ({pendingViews})
              </Button>
            )}
            {deployedViews > 0 && (
              <Button 
                icon="refresh" 
                onClick={handleRedeployAll}
                disabled={deploying}
              >
                Alle neu deployen ({deployedViews})
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
                      backgroundColor: view.is_deployed ? 'var(--view-card-deployed-bg)' : 'var(--view-card-pending-bg)',
                      border: '1px solid var(--view-card-border)'
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
                        <code style={{ fontSize: '12px', color: 'var(--view-card-text-muted)' }}>mds_view.{view.code}</code>
                        {view.description && (
                          <p style={{ margin: '8px 0 0', color: 'var(--view-card-text-muted)', fontSize: '14px' }}>
                            {view.description}
                          </p>
                        )}
                        {view.filter_condition && (
                          <p style={{ margin: '4px 0 0', color: 'var(--view-card-text-faint)', fontSize: '12px' }}>
                            Filter: <code>{view.filter_condition}</code>
                          </p>
                        )}
                        {view.last_deployed_at && (
                          <p style={{ margin: '4px 0 0', color: 'var(--view-card-text-faint)', fontSize: '12px' }}>
                            Zuletzt deployed: {formatDate(view.last_deployed_at)}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button 
                          small 
                          icon={view.is_deployed ? 'refresh' : 'cloud-upload'} 
                          intent={view.is_deployed ? 'none' : 'success'}
                          onClick={() => handleDeployView(view)}
                          loading={deployingIds.has(view.id)}
                          disabled={deploying && !deployingIds.has(view.id)}
                          title={view.is_deployed
                            ? 'View aus der aktuellen Definition neu erstellen (DROP + CREATE)'
                            : 'View deployen'}
                        >
                          {view.is_deployed ? 'Redeploy' : 'Deploy'}
                        </Button>
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
