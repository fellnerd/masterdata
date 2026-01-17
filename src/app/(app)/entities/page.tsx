'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Button, 
  HTMLTable, 
  Tag, 
  Icon,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Checkbox,
  Spinner,
  NonIdealState
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'
import { SectionHeader } from '@/components/ui/SectionHeader'

interface Entity {
  id: number
  code: string
  name: string
  description: string | null
  model_id: number
  model_code: string
  scd_type: 'SCD1' | 'SCD2'
  status: 'draft' | 'active' | 'deprecated'
  primary_key_attribute: string | null
  attribute_count: number
  created_at: string
  created_by: string
  // Import configuration
  import_source_object?: string | null
  import_column_mapping?: Record<string, string> | null
  import_filter?: string | null
  import_schedule?: string | null
  last_import_at?: string | null
}

interface Model {
  id: number
  code: string
  name: string
}

interface DvObject {
  name: string
  path: string
  schema: string
  materialized: string
  columns?: string[]
}

interface DvObjects {
  hubs: DvObject[]
  satellites: DvObject[]
  links: DvObject[]
  staging: DvObject[]
  marts: DvObject[]
}

interface Attribute {
  id: number
  code: string
  name: string
  data_type: string
  is_business_key: boolean
}

export default function EntitiesPage() {
  const router = useRouter()
  const [entities, setEntities] = useState<Entity[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterModel, setFilterModel] = useState<string>('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editEntity, setEditEntity] = useState<Entity | null>(null)
  const [newEntity, setNewEntity] = useState({
    code: '',
    name: '',
    model_id: 0,
    scd_type: 'SCD2' as 'SCD1' | 'SCD2'
  })
  
  // Import dialog state
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importEntity, setImportEntity] = useState<Entity | null>(null)
  const [dvObjects, setDvObjects] = useState<DvObjects | null>(null)
  const [entityAttributes, setEntityAttributes] = useState<Attribute[]>([])
  const [importConfig, setImportConfig] = useState({
    source_object: '',
    column_mapping: {} as Record<string, string>,
    filter: '',
    schedule: ''
  })
  const [isSavingImport, setIsSavingImport] = useState(false)
  const [isImportSourceConnected, setIsImportSourceConnected] = useState(false)

  // Fetch entities and models from API
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const [entitiesRes, modelsRes] = await Promise.all([
        fetch('/api/entities'),
        fetch('/api/models')
      ])
      
      if (!entitiesRes.ok || !modelsRes.ok) {
        throw new Error('Failed to load data')
      }
      
      const entitiesJson = await entitiesRes.json()
      const modelsJson = await modelsRes.json()
      
      setEntities(entitiesJson.data || [])
      setModels(modelsJson.data || [])
      
      // Set default model for create dialog
      if (modelsJson.data?.length > 0 && newEntity.model_id === 0) {
        setNewEntity(prev => ({ ...prev, model_id: modelsJson.data[0].id }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredEntities = filterModel 
    ? entities.filter(e => e.model_code === filterModel)
    : entities

  const handleCreate = async () => {
    try {
      setIsCreating(true)
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newEntity.code.toLowerCase().replace(/\s+/g, '_'),
          name: newEntity.name,
          model_id: newEntity.model_id,
          scd_type: newEntity.scd_type
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create entity')
      }
      
      setNewEntity({ code: '', name: '', model_id: models[0]?.id || 0, scd_type: 'SCD2' })
      setIsCreateOpen(false)
      fetchData() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create entity')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenEdit = (entity: Entity) => {
    setEditEntity(entity)
    setIsEditOpen(true)
  }

  const handleEditEntity = async () => {
    if (!editEntity) return
    try {
      setIsEditing(true)
      const res = await fetch(`/api/entities/${editEntity.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editEntity.name,
          description: editEntity.description,
          scd_type: editEntity.scd_type
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update entity')
      }
      
      setEditEntity(null)
      setIsEditOpen(false)
      fetchData() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update entity')
    } finally {
      setIsEditing(false)
    }
  }

  const handleDeleteEntity = async (entityId: number, entityCode: string) => {
    if (!confirm(`Are you sure you want to delete entity "${entityCode}"? This cannot be undone.`)) {
      return
    }
    
    try {
      const res = await fetch(`/api/entities/${entityId}`, {
        method: 'DELETE'
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete entity')
      }
      
      fetchData() // Refresh list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete entity')
    }
  }

  // Import Dialog handlers
  const handleOpenImport = async (entity: Entity) => {
    setImportEntity(entity)
    setIsImportOpen(true)
    
    // Load DV objects from import source
    try {
      const [sourceRes, objectsRes, attrsRes] = await Promise.all([
        fetch('/api/settings/import-source'),
        fetch('/api/settings/import-source/objects'),
        fetch(`/api/attributes?entity_id=${entity.id}`)
      ])
      
      const sourceData = await sourceRes.json()
      // API returns object directly (not wrapped in data property)
      setIsImportSourceConnected(sourceData?.status === 'connected')
      
      if (objectsRes.ok) {
        const objectsData = await objectsRes.json()
        // API returns { grouped: { hubs, satellites, ... }, objects, count }
        setDvObjects(objectsData.grouped || null)
      }
      
      if (attrsRes.ok) {
        const attrsData = await attrsRes.json()
        setEntityAttributes(attrsData.data || [])
      }
      
      // Load existing import config
      setImportConfig({
        source_object: entity.import_source_object || '',
        column_mapping: entity.import_column_mapping || {},
        filter: entity.import_filter || '',
        schedule: entity.import_schedule || ''
      })
    } catch (err) {
      console.error('Failed to load import data:', err)
    }
  }

  const handleSaveImport = async () => {
    if (!importEntity) return
    
    try {
      setIsSavingImport(true)
      const res = await fetch(`/api/entities/${importEntity.id}/import-mapping`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          import_source_object: importConfig.source_object || null,
          import_column_mapping: Object.keys(importConfig.column_mapping).length > 0 
            ? importConfig.column_mapping 
            : null,
          import_filter: importConfig.filter || null,
          import_schedule: importConfig.schedule || null
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save import mapping')
      }
      
      setIsImportOpen(false)
      setImportEntity(null)
      fetchData() // Refresh to show updated import info
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save import mapping')
    } finally {
      setIsSavingImport(false)
    }
  }

  const handleColumnMappingChange = (attributeCode: string, dvColumn: string) => {
    setImportConfig(prev => ({
      ...prev,
      column_mapping: {
        ...prev.column_mapping,
        [attributeCode]: dvColumn
      }
    }))
  }

  // Get columns from selected DV object
  const getSelectedObjectColumns = (): string[] => {
    if (!dvObjects || !importConfig.source_object) return []
    
    const allObjects = [
      ...dvObjects.hubs,
      ...dvObjects.satellites,
      ...dvObjects.links,
      ...dvObjects.staging,
      ...dvObjects.marts
    ]
    
    // Match by schema.name (full qualified name)
    const selected = allObjects.find(o => `${o.schema}.${o.name}` === importConfig.source_object)
    return selected?.columns || []
  }

  // Schedule import job for an entity (creates as pending, not immediately executed)
  const handleScheduleImport = async (entity: Entity) => {
    if (!entity.import_source_object) {
      alert('Please configure import settings first')
      return
    }
    
    if (!confirm(`Schedule import from "${entity.import_source_object}" for entity "${entity.name}"?\n\nThe job will be created as pending. You can start it manually from the Jobs page.`)) {
      return
    }
    
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'import',
          target: entity.code,
          params: {
            entity_id: entity.id,
            source_object: entity.import_source_object
          },
          scheduled: true  // Don't execute immediately, just schedule
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to schedule import job')
      }
      
      const job = await res.json()
      alert(`Import job scheduled! Job ID: ${job.id}\n\nGo to Jobs page to start or schedule it.`)
      router.push('/jobs')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to schedule import')
    }
  }

  if (loading) {
    return (
      <PageLayout 
        title="Entities" 
        breadcrumb={['Model Design', 'Entities']}
        loading={true}
        loadingText="Loading entities..."
      />
    )
  }

  // Compute summary stats
  const totalEntities = entities.length
  const activeEntities = entities.filter(e => e.status === 'active').length
  const scd2Entities = entities.filter(e => e.scd_type === 'SCD2').length
  const totalAttributes = entities.reduce((sum, e) => sum + e.attribute_count, 0)

  if (error) {
    return (
      <PageLayout 
        title="Entities" 
        breadcrumb={['Model Design', 'Entities']}
        error={error}
        onRetry={fetchData}
      />
    )
  }

  return (
    <PageLayout title="Entities" breadcrumb={['Model Design', 'Entities']}>
      <KpiGrid>
        <KpiCard label="Entities" value={totalEntities} />
        <KpiCard label="Active" value={activeEntities} />
        <KpiCard label="SCD2 History" value={scd2Entities} />
        <KpiCard label="Attributes" value={totalAttributes} />
      </KpiGrid>
      
      <SectionHeader 
        title="Entity Definitions"
        actions={
          <>
            <HTMLSelect 
              value={filterModel} 
              onChange={(e) => setFilterModel(e.target.value)}
              options={[
                { value: '', label: 'All Models' },
                ...models.map(m => ({ value: m.code, label: m.name }))
              ]}
            />
            <Button 
              icon="add" 
              intent="primary"
              onClick={() => setIsCreateOpen(true)}
              disabled={models.length === 0}
            >
              New Entity
            </Button>
          </>
        }
      />

      {entities.length === 0 ? (
        <NonIdealState
          icon="th"
          title="No entities yet"
          description={models.length === 0 ? "Create a model first, then add entities" : "Create your first entity to get started"}
          action={models.length > 0 ? <Button icon="add" intent="primary" onClick={() => setIsCreateOpen(true)}>Create Entity</Button> : undefined}
        />
      ) : (
        <>
          <div className="data-table-container">
            <HTMLTable striped interactive style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Model</th>
                    <th>Attributes</th>
                    <th>SCD Type</th>
                    <th>Import</th>
                    <th>Status</th>
                    <th style={{ width: 150 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntities.map((entity) => (
                    <tr key={entity.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon icon="th" size={14} className="text-muted" />
                          <div>
                            <div style={{ fontWeight: 500 }}>{entity.name}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{entity.code}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Tag minimal>{entity.model_code}</Tag>
                      </td>
                      <td>{entity.attribute_count}</td>
                      <td>
                        <Tag minimal intent={entity.scd_type === 'SCD2' ? 'success' : 'none'}>
                          {entity.scd_type}
                        </Tag>
                      </td>
                      <td>
                        {entity.import_source_object ? (
                          <Tag minimal intent="primary" icon="import">
                            {entity.import_source_object}
                          </Tag>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <Tag 
                          minimal 
                          intent={entity.status === 'active' ? 'success' : entity.status === 'draft' ? 'warning' : 'none'}
                        >
                          {entity.status}
                        </Tag>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button minimal small icon="edit" title="Edit" onClick={() => handleOpenEdit(entity)} />
                          <Button minimal small icon="column-layout" title="Attributes" onClick={() => router.push(`/attributes?entity_id=${entity.id}`)} />
                          <Button minimal small icon="import" title="Import Config" onClick={() => handleOpenImport(entity)} />
                          <Button 
                            minimal 
                            small 
                            icon="time" 
                            title="Schedule Import" 
                            intent="primary"
                            disabled={!entity.import_source_object}
                            onClick={() => handleScheduleImport(entity)} 
                          />
                          <Button minimal small icon="database" title="Data" onClick={() => router.push(`/data?entity_id=${entity.id}`)} />
                          <Button minimal small icon="trash" title="Delete" intent="danger" onClick={() => handleDeleteEntity(entity.id, entity.code)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            </div>

            <div className="text-muted" style={{ marginTop: 16, fontSize: 13 }}>
              Showing {filteredEntities.length} of {entities.length} entities
            </div>
        </>
      )}

      {/* Create Entity Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Entity"
        icon="th"
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Entity Code" labelFor="entity-code" labelInfo="(required)" helperText="Technical name (e.g., customer, product)">
            <InputGroup
              id="entity-code"
              placeholder="e.g., customer"
              value={newEntity.code}
              onChange={(e) => setNewEntity({ ...newEntity, code: e.target.value.toLowerCase() })}
            />
          </FormGroup>
          <FormGroup label="Display Name" labelFor="entity-name" labelInfo="(required)">
            <InputGroup
              id="entity-name"
              placeholder="e.g., Customers"
              value={newEntity.name}
              onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Model" labelFor="entity-model">
            <HTMLSelect
              id="entity-model"
              fill
              value={newEntity.model_id}
              onChange={(e) => setNewEntity({ ...newEntity, model_id: Number(e.target.value) })}
              options={models.map(m => ({ value: m.id, label: m.name }))}
            />
          </FormGroup>
          <FormGroup label="SCD Type" labelFor="entity-scd-type" helperText="SCD1: No history (overwrite) | SCD2: Full history tracking">
            <HTMLSelect
              id="entity-scd-type"
              fill
              value={newEntity.scd_type}
              onChange={(e) => setNewEntity({ ...newEntity, scd_type: e.target.value as 'SCD1' | 'SCD2' })}
              options={[
                { value: 'SCD1', label: 'SCD1 - No History (Overwrite)' },
                { value: 'SCD2', label: 'SCD2 - Full History Tracking' }
              ]}
            />
          </FormGroup>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
            <Button 
              intent="primary" 
              onClick={handleCreate}
              disabled={!newEntity.code.trim() || !newEntity.name.trim() || isCreating}
              loading={isCreating}
            >
              Create Entity
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Edit Entity Dialog */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditEntity(null); }}
        title="Edit Entity"
        icon="edit"
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Entity Code" labelFor="edit-entity-code" helperText="Code cannot be changed">
            <InputGroup
              id="edit-entity-code"
              value={editEntity?.code || ''}
              disabled
            />
          </FormGroup>
          <FormGroup label="Display Name" labelFor="edit-entity-name" labelInfo="(required)">
            <InputGroup
              id="edit-entity-name"
              placeholder="e.g., Customers"
              value={editEntity?.name || ''}
              onChange={(e) => editEntity && setEditEntity({ ...editEntity, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="SCD Type" labelFor="edit-entity-scd-type" helperText="SCD1: No history | SCD2: Full history tracking">
            <HTMLSelect
              id="edit-entity-scd-type"
              fill
              value={editEntity?.scd_type || 'SCD2'}
              onChange={(e) => editEntity && setEditEntity({ ...editEntity, scd_type: e.target.value as 'SCD1' | 'SCD2' })}
              options={[
                { value: 'SCD1', label: 'SCD1 - No History (Overwrite)' },
                { value: 'SCD2', label: 'SCD2 - Full History Tracking' }
              ]}
            />
          </FormGroup>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => { setIsEditOpen(false); setEditEntity(null); }} disabled={isEditing}>Cancel</Button>
            <Button 
              intent="primary" 
              onClick={handleEditEntity}
              disabled={!editEntity?.name?.trim() || isEditing}
              loading={isEditing}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Import Configuration Dialog */}
      <Dialog
        isOpen={isImportOpen}
        onClose={() => { setIsImportOpen(false); setImportEntity(null); }}
        title={`Import Configuration: ${importEntity?.name || ''}`}
        icon="import"
        style={{ width: 700 }}
      >
        <div className="bp5-dialog-body">
          {!isImportSourceConnected ? (
            <NonIdealState
              icon="warning-sign"
              title="No Import Source Connected"
              description="Please connect a Data Vault dbt project in Settings → Data Sources first."
              action={
                <Button 
                  intent="primary" 
                  icon="settings"
                  onClick={() => router.push('/settings/sources')}
                >
                  Go to Settings
                </Button>
              }
            />
          ) : (
            <>
              <FormGroup 
                label="Source Object" 
                labelFor="import-source-object" 
                labelInfo="(required)"
                helperText="Select the Data Vault object to import from (Hub, Satellite, Link, etc.)"
              >
                <HTMLSelect
                  id="import-source-object"
                  fill
                  value={importConfig.source_object}
                  onChange={(e) => setImportConfig(prev => ({ 
                    ...prev, 
                    source_object: e.target.value,
                    column_mapping: {} // Reset mapping when object changes
                  }))}
                  options={[
                    { value: '', label: '-- Select Object --' },
                    ...(dvObjects ? [
                      { value: '__sep_hubs__', label: '─── Hubs ───', disabled: true },
                      ...dvObjects.hubs.map(o => ({ value: `${o.schema}.${o.name}`, label: `${o.schema}.${o.name}` })),
                      { value: '__sep_satellites__', label: '─── Satellites ───', disabled: true },
                      ...dvObjects.satellites.map(o => ({ value: `${o.schema}.${o.name}`, label: `${o.schema}.${o.name}` })),
                      { value: '__sep_links__', label: '─── Links ───', disabled: true },
                      ...dvObjects.links.map(o => ({ value: `${o.schema}.${o.name}`, label: `${o.schema}.${o.name}` })),
                      { value: '__sep_staging__', label: '─── Staging ───', disabled: true },
                      ...dvObjects.staging.map(o => ({ value: `${o.schema}.${o.name}`, label: `${o.schema}.${o.name}` })),
                      { value: '__sep_marts__', label: '─── Marts ───', disabled: true },
                      ...dvObjects.marts.map(o => ({ value: `${o.schema}.${o.name}`, label: `${o.schema}.${o.name}` })),
                    ] : [])
                  ]}
                />
              </FormGroup>

              {importConfig.source_object && (
                <>
                  <FormGroup 
                    label="Column Mapping" 
                    helperText="Map entity attributes to Data Vault columns. Leave empty for auto-mapping by name."
                  >
                    <HTMLTable striped style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th>Entity Attribute</th>
                          <th>Data Vault Column</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entityAttributes.map((attr) => (
                          <tr key={attr.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {attr.is_business_key && <Icon icon="key" size={12} intent="warning" />}
                                <span>{attr.name}</span>
                                <span className="text-muted" style={{ fontSize: 11 }}>({attr.code})</span>
                              </div>
                            </td>
                            <td>
                              <HTMLSelect
                                fill
                                value={importConfig.column_mapping[attr.code] || ''}
                                onChange={(e) => handleColumnMappingChange(attr.code, e.target.value)}
                                options={[
                                  { value: '', label: `-- Auto (${attr.code}) --` },
                                  ...getSelectedObjectColumns().map(col => ({ value: col, label: col }))
                                ]}
                              />
                            </td>
                          </tr>
                        ))}
                        {entityAttributes.length === 0 && (
                          <tr>
                            <td colSpan={2} className="text-muted" style={{ textAlign: 'center', padding: 20 }}>
                              No attributes defined for this entity. Add attributes first.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </HTMLTable>
                  </FormGroup>

                  <FormGroup 
                    label="Filter (WHERE clause)" 
                    labelFor="import-filter"
                    helperText="Optional SQL WHERE clause to filter records (e.g., status = 'active')"
                  >
                    <InputGroup
                      id="import-filter"
                      placeholder="e.g., status = 'active' AND created_at > '2024-01-01'"
                      value={importConfig.filter}
                      onChange={(e) => setImportConfig(prev => ({ ...prev, filter: e.target.value }))}
                    />
                  </FormGroup>

                  <FormGroup 
                    label="Schedule (Cron)" 
                    labelFor="import-schedule"
                    helperText="Optional cron expression for automatic import (e.g., 0 2 * * * for daily at 2 AM)"
                  >
                    <InputGroup
                      id="import-schedule"
                      placeholder="e.g., 0 2 * * * (daily at 2 AM)"
                      value={importConfig.schedule}
                      onChange={(e) => setImportConfig(prev => ({ ...prev, schedule: e.target.value }))}
                    />
                  </FormGroup>
                </>
              )}
            </>
          )}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => { setIsImportOpen(false); setImportEntity(null); }} disabled={isSavingImport}>
              Cancel
            </Button>
            {isImportSourceConnected && (
              <Button 
                intent="primary" 
                onClick={handleSaveImport}
                disabled={!importConfig.source_object || isSavingImport}
                loading={isSavingImport}
              >
                Save Import Configuration
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </PageLayout>
  )
}
