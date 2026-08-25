'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  HTMLTable,
  Tag,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Checkbox,
  NumericInput,
  Tabs,
  Tab,
  Spinner,
  NonIdealState,
  Callout,
  Icon,
  TextArea,
  Collapse,
  Tooltip
} from '@blueprintjs/core'
import { DateInput } from '@blueprintjs/datetime'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { ReferenceInput } from '@/components/data/ReferenceInput'
import { useAttributeFilterPersistence } from '@/hooks/useAttributeFilterPersistence'

const STORAGE_KEY = 'mds_filter_data_entity_id'

// Define a type for dynamic data values
type DataValue = string | number | boolean | null

interface Entity {
  id: number
  code: string
  name: string
  model_code: string
}

interface Attribute {
  id: number
  entity_id: number
  code: string
  name: string
  data_type: string
  is_required: boolean
  is_business_key: boolean
  reference_entity_id: number | null
  reference_entity_code?: string | null
}

interface StagedRecord {
  id: number
  entity_id: number
  entity_name: string
  operation: string
  business_key: string
  data: Record<string, DataValue>
  validation_status: string
  created_at: string
  created_by: string
}

interface Summary {
  total: number
  draft: number
  validated: number
  invalid: number
}

// Turns one active `attr.*` filter entry into a short human-readable chip
// label, e.g. "Amount ≥ 100" or "Status = active". Mirrors the
// suffix semantics in src/lib/attributeFilters.ts.
function describeAttributeFilter(paramKey: string, value: string, attrs: Attribute[]): string {
  const stripped = paramKey.slice('attr.'.length)
  const match = stripped.match(/^(.+)\.(min|max|from|to|exact)$/)
  const code = match ? match[1] : stripped
  const suffix = match ? match[2] : null
  const label = attrs.find(a => a.code === code)?.name || code

  switch (suffix) {
    case 'min': return `${label} ≥ ${value}`
    case 'max': return `${label} ≤ ${value}`
    case 'from': return `${label} ab ${value}`
    case 'to': return `${label} bis ${value}`
    case 'exact': return `${label} = ${value}`
    default: return `${label}: "${value}"`
  }
}

export default function DataEntryPage() {
  return (
    <Suspense>
      <DataEntryPageInner />
    </Suspense>
  )
}

function DataEntryPageInner() {
  const searchParams = useSearchParams()
  const [entities, setEntities] = useState<Entity[]>([])
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [records, setRecords] = useState<StagedRecord[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, draft: 0, validated: 0, invalid: 0 })
  const [selectedEntityId, setSelectedEntityId] = useState<number>(0)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editRecord, setEditRecord] = useState<StagedRecord | null>(null)
  const [editData, setEditData] = useState<Record<string, DataValue>>({})
  const [selectedRecord, setSelectedRecord] = useState<StagedRecord | null>(null)
  const [newRecord, setNewRecord] = useState<Record<string, DataValue>>({})
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(new Set())
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitMode, setCommitMode] = useState<'selected' | 'all'>('selected')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [attributeFilters, setAttributeFilters] = useAttributeFilterPersistence(selectedEntityId || undefined)
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)

  // Query string fragment for the active attr.* filters, shared by the
  // records fetch effect and refreshRecords below.
  const attributeFilterQuery = Object.entries(attributeFilters)
    .filter(([, v]) => v)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('')

  // Fetch entities on mount, then pick the initial selection with priority
  // ?entity_id= (set by Entities page row links) > ?model= (set by Model
  // card links - first entity of that model) > last selection remembered
  // in localStorage > first entity overall.
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const res = await fetch('/api/entities')
        if (!res.ok) throw new Error('Failed to load entities')
        const json = await res.json()
        const fetchedEntities: Entity[] = json.data || []
        setEntities(fetchedEntities)

        if (fetchedEntities.length === 0) return

        const entityIdParam = searchParams.get('entity_id')
        const modelParam = searchParams.get('model')
        let resolvedId: number | undefined

        if (entityIdParam && fetchedEntities.some(e => e.id === Number(entityIdParam))) {
          resolvedId = Number(entityIdParam)
        } else if (modelParam) {
          resolvedId = fetchedEntities.find(e => e.model_code === modelParam)?.id
        }

        if (!resolvedId) {
          try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (stored && fetchedEntities.some(e => e.id === Number(stored))) {
              resolvedId = Number(stored)
            }
          } catch {
            // ignore
          }
        }

        setSelectedEntityId(resolvedId || fetchedEntities[0].id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entities')
      } finally {
        setLoading(false)
      }
    }
    fetchEntities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch attributes when entity changes
  useEffect(() => {
    if (!selectedEntityId) return
    setCurrentPage(1) // Reset to page 1 when entity changes
    
    const fetchAttributes = async () => {
      try {
        const attrsRes = await fetch(`/api/attributes?entity_id=${selectedEntityId}`)
        if (!attrsRes.ok) throw new Error('Failed to load attributes')
        const attrsJson = await attrsRes.json()
        setAttributes(attrsJson.data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load attributes')
      }
    }
    fetchAttributes()
  }, [selectedEntityId])

  // Fetch records when entity, page, pageSize or attribute filters change
  useEffect(() => {
    if (!selectedEntityId) return

    const fetchRecords = async () => {
      try {
        setLoading(true)
        const recordsRes = await fetch(`/api/records?entity_id=${selectedEntityId}&page=${currentPage}&pageSize=${pageSize}${attributeFilterQuery}`)

        if (!recordsRes.ok) throw new Error('Failed to load data')

        const recordsJson = await recordsRes.json()

        setRecords(recordsJson.data || [])
        setTotalRecords(recordsJson.pagination?.total || recordsJson.summary?.total || 0)
        setSummary(recordsJson.summary || { total: 0, draft: 0, validated: 0, invalid: 0 })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    fetchRecords()
  }, [selectedEntityId, currentPage, pageSize, attributeFilterQuery])

  // Helper function to refresh records
  const refreshRecords = async () => {
    const recordsRes = await fetch(`/api/records?entity_id=${selectedEntityId}&page=${currentPage}&pageSize=${pageSize}${attributeFilterQuery}`)
    const recordsJson = await recordsRes.json()
    setRecords(recordsJson.data || [])
    setTotalRecords(recordsJson.pagination?.total || recordsJson.summary?.total || 0)
    setSummary(recordsJson.summary || summary)
  }

  // Helper for case-insensitive status check (DB uses UPPERCASE, UI uses lowercase)
  const isPending = (record: StagedRecord) => 
    record.validation_status?.toUpperCase() === 'PENDING'

  const filteredRecords = records.filter(r => !filterStatus || r.validation_status?.toLowerCase() === filterStatus.toLowerCase())

  const selectedEntity = entities.find(e => e.id === selectedEntityId)
  const businessKeyAttr = attributes.find(a => a.is_business_key)

  // Shared field control for the Add/Edit Record forms, dispatched by
  // data_type so stored values are canonical (JSON boolean/number, ISO date)
  // rather than whatever raw string someone typed - the attribute filters
  // (see attributeFilters.ts) TRY_CAST these values per type, so a
  // non-canonical stored value would silently fail to match a filter.
  const renderFieldControl = (
    attr: Attribute,
    fieldId: string,
    values: Record<string, DataValue>,
    setValues: (next: Record<string, DataValue>) => void
  ) => {
    if (attr.data_type === 'reference' && attr.reference_entity_id) {
      return (
        <ReferenceInput
          id={fieldId}
          referencedEntityId={attr.reference_entity_id}
          referencedEntityName={attr.reference_entity_code || undefined}
          value={String(values[attr.code] ?? '')}
          onChange={(v) => setValues({ ...values, [attr.code]: v })}
          intent={attr.is_business_key ? 'primary' : 'none'}
        />
      )
    }

    if (attr.data_type === 'boolean') {
      const raw = values[attr.code]
      const checked = raw === true || raw === 'true'
      return (
        <Checkbox
          id={fieldId}
          checked={checked}
          label={attr.name}
          onChange={(e) => setValues({ ...values, [attr.code]: (e.target as HTMLInputElement).checked })}
        />
      )
    }

    if (attr.data_type === 'date' || attr.data_type === 'datetime') {
      const isDatetime = attr.data_type === 'datetime'
      const raw = values[attr.code]
      return (
        <DateInput
          inputProps={{
            id: fieldId,
            placeholder: `Enter ${attr.name.toLowerCase()}`,
            intent: attr.is_business_key ? 'primary' : 'none'
          }}
          value={raw ? String(raw) : null}
          dateFnsFormat={isDatetime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd'}
          timePrecision={isDatetime ? 'minute' : undefined}
          canClearSelection
          showActionsBar
          onChange={(newDate) => setValues({ ...values, [attr.code]: newDate ?? '' })}
        />
      )
    }

    if (attr.data_type === 'integer' || attr.data_type === 'decimal') {
      const raw = values[attr.code]
      return (
        <NumericInput
          id={fieldId}
          fill
          placeholder={`Enter ${attr.name.toLowerCase()}`}
          value={raw === '' || raw === undefined || raw === null ? '' : Number(raw)}
          stepSize={attr.data_type === 'integer' ? 1 : 0.01}
          minorStepSize={attr.data_type === 'integer' ? null : 0.01}
          intent={attr.is_business_key ? 'primary' : 'none'}
          onValueChange={(valueAsNumber, valueAsString) => setValues({
            ...values,
            [attr.code]: valueAsString === '' || Number.isNaN(valueAsNumber) ? '' : valueAsNumber
          })}
        />
      )
    }

    return (
      <InputGroup
        id={fieldId}
        type="text"
        placeholder={`Enter ${attr.name.toLowerCase()}`}
        value={String(values[attr.code] ?? '')}
        onChange={(e) => setValues({ ...values, [attr.code]: e.target.value })}
        intent={attr.is_business_key ? 'primary' : 'none'}
      />
    )
  }

  const handleCreate = async () => {
    if (!selectedEntityId || !businessKeyAttr) return
    
    try {
      setIsCreating(true)
      const businessKey = String(newRecord[businessKeyAttr.code] || '')
      
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_id: selectedEntityId,
          operation: 'INSERT',
          business_key: businessKey,
          data: newRecord
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create record')
      }
      
      setNewRecord({})
      setIsCreateOpen(false)
      // Refresh records
      await refreshRecords()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create record')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenEdit = (record: StagedRecord) => {
    setEditRecord(record)
    setEditData(record.data as Record<string, DataValue>)
    setIsEditOpen(true)
  }

  const handleEditRecord = async () => {
    if (!editRecord) return
    try {
      setIsEditing(true)
      const res = await fetch(`/api/records/${editRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: editData
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update record')
      }
      
      setEditRecord(null)
      setEditData({})
      setIsEditOpen(false)
      // Refresh records
      await refreshRecords()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update record')
    } finally {
      setIsEditing(false)
    }
  }

  const handleDeleteRecord = async (recordId: number, isLoaded: boolean) => {
    const confirmMessage = isLoaded 
      ? 'This will create a DELETE operation for this record. The deletion will be applied after commit and deploy. Continue?'
      : 'Are you sure you want to delete this pending record?'
    
    if (!confirm(confirmMessage)) {
      return
    }
    
    try {
      const res = await fetch(`/api/records/${recordId}`, {
        method: 'DELETE'
      })
      
      const result = await res.json()
      
      if (!res.ok) {
        throw new Error(result.error || 'Failed to delete record')
      }
      
      // Show success message for DELETE operation creation
      if (result.action === 'delete_operation_created') {
        alert(result.message)
      }
      
      // Refresh records
      await refreshRecords()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete record')
    }
  }

  const handleToggleRecord = (recordId: number) => {
    setSelectedRecordIds(prev => {
      const next = new Set(prev)
      if (next.has(recordId)) {
        next.delete(recordId)
      } else {
        next.add(recordId)
      }
      return next
    })
  }

  const handleToggleAll = () => {
    if (selectedRecordIds.size === filteredRecords.length) {
      setSelectedRecordIds(new Set())
    } else {
      setSelectedRecordIds(new Set(filteredRecords.map(r => r.id)))
    }
  }

  const handleCommitSelected = async () => {
    if (selectedRecordIds.size === 0) return
    setCommitMode('selected')
    setCommitDialogOpen(true)
  }

  // Commit all pending changes (INSERT, UPDATE, DELETE with status='pending')
  const handleCommitAllChanges = async () => {
    if (summary.draft === 0) {
      alert('No pending changes to commit.')
      return
    }
    setCommitMode('all')
    setCommitDialogOpen(true)
  }

  const handleConfirmCommit = async () => {
    // For 'selected' mode: send specific IDs
    // For 'all' mode: don't send change_ids - API will commit ALL pending records
    const idsToCommit = commitMode === 'selected' 
      ? Array.from(selectedRecordIds)
      : null // null means commit ALL pending for this entity
    
    if (commitMode === 'selected' && (!idsToCommit || idsToCommit.length === 0)) return
    
    try {
      setIsCommitting(true)
      const requestBody: Record<string, unknown> = {
        entity_id: selectedEntityId,
        description: commitMessage || null
      }
      // Only include change_ids for selected mode
      if (idsToCommit) {
        requestBody.change_ids = idsToCommit
      }
      
      const res = await fetch('/api/commits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to create commit')
      }
      // Clear selection and close dialog
      setSelectedRecordIds(new Set())
      setCommitDialogOpen(false)
      setCommitMessage('')
      // Refresh records
      await refreshRecords()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to commit records')
    } finally {
      setIsCommitting(false)
    }
  }

  // Bulk delete selected records
  const [isDeleting, setIsDeleting] = useState(false)
  
  const handleBulkDelete = async () => {
    if (selectedRecordIds.size === 0) return
    
    const selectedRecords = records.filter(r => selectedRecordIds.has(r.id))
    const pendingCount = selectedRecords.filter(isPending).length
    const loadedCount = selectedRecords.filter(r => r.validation_status === 'loaded').length
    
    let confirmMessage = `Delete ${selectedRecordIds.size} selected records?\n\n`
    if (pendingCount > 0) confirmMessage += `• ${pendingCount} pending records will be permanently deleted\n`
    if (loadedCount > 0) confirmMessage += `• ${loadedCount} loaded records will be marked for deletion (requires commit & deploy)`
    
    if (!confirm(confirmMessage)) return
    
    try {
      setIsDeleting(true)
      let deleted = 0
      let markedForDelete = 0
      let errors = 0
      
      for (const recordId of selectedRecordIds) {
        try {
          const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE' })
          const result = await res.json()
          if (res.ok) {
            if (result.action === 'deleted') deleted++
            else markedForDelete++
          } else {
            errors++
          }
        } catch {
          errors++
        }
      }
      
      // Show result
      let resultMsg = ''
      if (deleted > 0) resultMsg += `${deleted} records deleted. `
      if (markedForDelete > 0) resultMsg += `${markedForDelete} records marked for deletion. `
      if (errors > 0) resultMsg += `${errors} errors.`
      if (resultMsg) alert(resultMsg)
      
      // Clear selection and refresh
      setSelectedRecordIds(new Set())
      await refreshRecords()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete records')
    } finally {
      setIsDeleting(false)
    }
  }

  const getStatusIntent = (status: string) => {
    switch (status) {
      case 'valid': return 'success'
      case 'pending': return 'warning'
      case 'invalid': return 'danger'
      default: return 'none'
    }
  }

  if (loading && entities.length === 0) {
    return (
      <PageLayout 
        title="Data Entry" 
        breadcrumb={['Data Management', 'Data Entry']}
        loading={true}
        loadingText="Loading data..."
      />
    )
  }

  if (error && entities.length === 0) {
    return (
      <PageLayout 
        title="Data Entry" 
        breadcrumb={['Data Management', 'Data Entry']}
        error={error}
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <PageLayout title="Data Entry" breadcrumb={['Data Management', 'Data Entry']}>
      <KpiGrid>
        <KpiCard label="Total Records" value={summary.total} />
        <KpiCard label="Draft" value={summary.draft} />
        <KpiCard label="Validated" value={summary.validated} />
        <KpiCard label="Invalid" value={summary.invalid} />
      </KpiGrid>
      
      <SectionHeader 
        title="Master Data Records"
        actions={
          <>
            <HTMLSelect
              value={selectedEntityId}
              onChange={(e) => {
                const id = Number(e.target.value)
                setSelectedEntityId(id)
                try {
                  localStorage.setItem(STORAGE_KEY, String(id))
                } catch {
                  // ignore
                }
              }}
              options={entities.map(e => ({ value: e.id, label: e.name }))}
            />
            <HTMLSelect 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: '', label: 'All Status' },
                { value: 'pending', label: 'Pending' },
                { value: 'valid', label: 'Valid' },
                { value: 'invalid', label: 'Invalid' }
              ]}
            />
            <Button
              icon="filter-list"
              active={isFilterPanelOpen}
              intent={Object.values(attributeFilters).some(Boolean) ? 'primary' : 'none'}
              onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
            >
              Filters{Object.values(attributeFilters).filter(Boolean).length > 0 ? ` (${Object.values(attributeFilters).filter(Boolean).length})` : ''}
            </Button>
            <Button
              icon="trash"
              intent="danger"
              disabled={selectedRecordIds.size === 0}
              loading={isDeleting}
              onClick={handleBulkDelete}
            >
              Löschen ({selectedRecordIds.size})
            </Button>
            <Button
              icon="add"
              intent="primary"
              onClick={() => setIsCreateOpen(true)}
              disabled={!selectedEntityId || attributes.length === 0}
            >
              Add Record
            </Button>
          </>
        }
      />

      <Collapse isOpen={isFilterPanelOpen}>
        <div style={{
          padding: 16,
          marginBottom: 16,
          background: 'var(--card-bg-secondary, #f5f8fa)',
          border: '1px solid var(--border-color, #e1e8ed)',
          borderRadius: 6
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon icon="filter-list" size={14} className="text-muted" />
              <span style={{ fontWeight: 600, fontSize: 12 }}>Attribute Filters</span>
              {Object.keys(attributeFilters).length === 0 && (
                <span className="text-muted" style={{ fontSize: 11 }}>&mdash; keine aktiv</span>
              )}
            </div>
            {Object.keys(attributeFilters).length > 0 && (
              <Button
                icon="filter-remove"
                minimal
                small
                onClick={() => { setAttributeFilters({}); setCurrentPage(1) }}
              >
                Alle löschen
              </Button>
            )}
          </div>

          {Object.entries(attributeFilters).filter(([, v]) => v).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {Object.entries(attributeFilters).filter(([, v]) => v).map(([paramKey, value]) => (
                <Tag
                  key={paramKey}
                  minimal
                  round
                  onRemove={() => {
                    const next = { ...attributeFilters }
                    delete next[paramKey]
                    setAttributeFilters(next)
                    setCurrentPage(1)
                  }}
                >
                  {describeAttributeFilter(paramKey, value, attributes)}
                </Tag>
              ))}
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14
          }}>
            {attributes.map(attr => {
              const key = `attr.${attr.code}`
              const update = (patch: Record<string, string>) => {
                const next = { ...attributeFilters, ...patch }
                Object.keys(next).forEach(k => { if (!next[k]) delete next[k] })
                setAttributeFilters(next)
                setCurrentPage(1)
              }

              if (attr.data_type === 'reference' && attr.reference_entity_id) {
                return (
                  <FormGroup key={attr.id} label={attr.name} labelFor={`filter-${attr.code}`}>
                    <ReferenceInput
                      id={`filter-${attr.code}`}
                      referencedEntityId={attr.reference_entity_id}
                      referencedEntityName={attr.reference_entity_code || undefined}
                      value={attributeFilters[key] ?? ''}
                      onChange={(v) => update({ [key]: v })}
                    />
                  </FormGroup>
                )
              }

              if (attr.data_type === 'boolean') {
                return (
                  <FormGroup key={attr.id} label={attr.name} labelFor={`filter-${attr.code}`}>
                    <HTMLSelect
                      id={`filter-${attr.code}`}
                      fill
                      value={attributeFilters[key] ?? ''}
                      onChange={(e) => update({ [key]: e.target.value })}
                      options={[
                        { value: '', label: 'Alle' },
                        { value: 'true', label: 'True' },
                        { value: 'false', label: 'False' }
                      ]}
                    />
                  </FormGroup>
                )
              }

              if (attr.data_type === 'integer' || attr.data_type === 'decimal') {
                const minKey = `${key}.min`
                const maxKey = `${key}.max`
                return (
                  <FormGroup key={attr.id} label={attr.name}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <NumericInput
                        placeholder="Min"
                        buttonPosition="none"
                        fill
                        value={attributeFilters[minKey] ?? ''}
                        onValueChange={(_n, str) => update({ [minKey]: str })}
                      />
                      <span className="text-muted" style={{ fontSize: 11 }}>–</span>
                      <NumericInput
                        placeholder="Max"
                        buttonPosition="none"
                        fill
                        value={attributeFilters[maxKey] ?? ''}
                        onValueChange={(_n, str) => update({ [maxKey]: str })}
                      />
                    </div>
                  </FormGroup>
                )
              }

              if (attr.data_type === 'date' || attr.data_type === 'datetime') {
                const isDatetime = attr.data_type === 'datetime'
                const fromKey = `${key}.from`
                const toKey = `${key}.to`
                const fmt = isDatetime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd'
                return (
                  <FormGroup key={attr.id} label={attr.name}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DateInput
                        inputProps={{ placeholder: 'Von' }}
                        value={attributeFilters[fromKey] || null}
                        dateFnsFormat={fmt}
                        timePrecision={isDatetime ? 'minute' : undefined}
                        canClearSelection
                        onChange={(d) => update({ [fromKey]: d ?? '' })}
                      />
                      <span className="text-muted" style={{ fontSize: 11 }}>–</span>
                      <DateInput
                        inputProps={{ placeholder: 'Bis' }}
                        value={attributeFilters[toKey] || null}
                        dateFnsFormat={fmt}
                        timePrecision={isDatetime ? 'minute' : undefined}
                        canClearSelection
                        onChange={(d) => update({ [toKey]: d ?? '' })}
                      />
                    </div>
                  </FormGroup>
                )
              }

              // string - "contains" by default, with an opt-in toggle for an
              // exact match instead (attr.<code>.exact=, useful for dropdown-
              // style values where a substring match is too loose).
              const exactKey = `${key}.exact`
              const isExact = exactKey in attributeFilters
              const currentValue = attributeFilters[isExact ? exactKey : key] ?? ''
              return (
                <FormGroup key={attr.id} label={attr.name} labelFor={`filter-${attr.code}`}>
                  <InputGroup
                    id={`filter-${attr.code}`}
                    placeholder={isExact ? 'Exakter Wert...' : 'Enthält...'}
                    value={currentValue}
                    onChange={(e) => update({ [isExact ? exactKey : key]: e.target.value })}
                    rightElement={
                      <Tooltip
                        content={isExact ? 'Exakte Übereinstimmung – klicken für "Enthält"' : '"Enthält" – klicken für exakte Übereinstimmung'}
                        placement="top"
                      >
                        <Button
                          icon={isExact ? 'equals' : 'search'}
                          minimal
                          small
                          active={isExact}
                          onClick={() => {
                            const next = { ...attributeFilters }
                            delete next[key]
                            delete next[exactKey]
                            if (currentValue) {
                              next[isExact ? key : exactKey] = currentValue
                            }
                            setAttributeFilters(next)
                            setCurrentPage(1)
                          }}
                        />
                      </Tooltip>
                    }
                  />
                </FormGroup>
              )
            })}
          </div>
        </div>
      </Collapse>

      {entities.length === 0 && (
        <Callout intent="warning" icon="info-sign" style={{ marginBottom: 16 }}>
          No entities found. Create an entity first in the Entities page.
        </Callout>
      )}

      {selectedEntityId > 0 && attributes.length === 0 && (
        <Callout intent="warning" icon="info-sign" style={{ marginBottom: 16 }}>
          No attributes defined for {selectedEntity?.name}. Create attributes first in the Attributes page.
        </Callout>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={30} /></div>
      ) : filteredRecords.length === 0 ? (
        <NonIdealState
          icon="database"
          title="No Records"
          description={`No staged records found for ${selectedEntity?.name || 'this entity'}.`}
        />
      ) : (
        <div className="data-table-container" style={{ overflowX: 'auto' }}>
          <HTMLTable striped interactive style={{ width: '100%', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <Checkbox 
                    checked={filteredRecords.length > 0 && selectedRecordIds.size === filteredRecords.length}
                    indeterminate={selectedRecordIds.size > 0 && selectedRecordIds.size < filteredRecords.length}
                    onChange={handleToggleAll}
                  />
                </th>
                <th>Business Key</th>
                {attributes.map(attr => (
                  <th key={attr.id}>{attr.name}</th>
                ))}
                <th>Operation</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id} onClick={() => setSelectedRecord(record)} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Checkbox 
                      checked={selectedRecordIds.has(record.id)}
                      onChange={() => handleToggleRecord(record.id)}
                    />
                  </td>
                  <td><strong>{record.business_key}</strong></td>
                  {attributes.map(attr => (
                    <td key={attr.id}>
                      {String(record.data[attr.code] ?? '-')}
                      </td>
                    ))}
                    <td>
                      <Tag minimal>{record.operation}</Tag>
                    </td>
                    <td>
                      <Tag minimal intent={getStatusIntent(record.validation_status)}>
                        {record.validation_status}
                      </Tag>
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
                      {new Date(record.created_at).toLocaleDateString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button minimal small icon="edit" title="Edit" onClick={() => handleOpenEdit(record)} />
                        <Button 
                          minimal 
                          small 
                          icon="trash" 
                          title={isPending(record) ? 'Delete' : 'Create DELETE operation'}
                          intent="danger" 
                          onClick={() => handleDeleteRecord(record.id, record.validation_status !== 'pending')}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        )}

      {/* Pagination Controls */}
      <div style={{ marginTop: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #e1e8ed' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords.toLocaleString()} records
          </span>
          <HTMLSelect
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            options={[
              { value: 25, label: '25 per page' },
              { value: 50, label: '50 per page' },
              { value: 100, label: '100 per page' },
              { value: 200, label: '200 per page' }
            ]}
            style={{ fontSize: 12 }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button
            small
            icon="double-chevron-left"
            disabled={currentPage === 1 || loading}
            onClick={() => setCurrentPage(1)}
            title="First page"
          />
          <Button
            small
            icon="chevron-left"
            disabled={currentPage === 1 || loading}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            title="Previous page"
          />
          <span style={{ padding: '0 12px', fontSize: 12 }}>
            Page {currentPage} of {Math.ceil(totalRecords / pageSize) || 1}
          </span>
          <Button
            small
            icon="chevron-right"
            disabled={currentPage >= Math.ceil(totalRecords / pageSize) || loading}
            onClick={() => setCurrentPage(p => p + 1)}
            title="Next page"
          />
          <Button
            small
            icon="double-chevron-right"
            disabled={currentPage >= Math.ceil(totalRecords / pageSize) || loading}
            onClick={() => setCurrentPage(Math.ceil(totalRecords / pageSize))}
            title="Last page"
          />
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-muted" style={{ fontSize: 11 }}>
          {selectedRecordIds.size > 0 && `${selectedRecordIds.size} selected • `}
          {summary.draft > 0 && 
            `${summary.draft.toLocaleString()} pending changes (total)`}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button 
            icon="git-commit" 
            intent="primary"
            disabled={summary.draft === 0}
            loading={isCommitting}
            onClick={handleCommitAllChanges}
          >
            Commit All Changes ({summary.draft.toLocaleString()})
          </Button>
          <Button 
            icon="git-commit" 
            disabled={selectedRecordIds.size === 0}
            loading={isCommitting}
            onClick={handleCommitSelected}
          >
            Commit Selected
          </Button>
          <Button icon="export">Export</Button>
        </div>
      </div>

      {/* Create Record Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={`Add ${selectedEntity?.name || 'Record'}`}
        icon="add"
        style={{ width: 500 }}
      >
        <div className="bp5-dialog-body">
          {attributes.map(attr => (
            <FormGroup 
              key={attr.id} 
              label={attr.name} 
              labelFor={attr.code}
              labelInfo={attr.is_required ? '(required)' : ''}
              helperText={attr.is_business_key ? 'Business Key' : undefined}
            >
              {renderFieldControl(attr, attr.code, newRecord, setNewRecord)}
            </FormGroup>
          ))}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button small onClick={() => { setIsCreateOpen(false); setNewRecord({}); }}>Cancel</Button>
            <Button 
              small
              intent="primary" 
              onClick={handleCreate}
              loading={isCreating}
              disabled={!businessKeyAttr || !newRecord[businessKeyAttr.code]}
            >
              Add Record
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Record Detail Panel */}
      <Dialog
        isOpen={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title={`Record: ${selectedRecord?.business_key}`}
        icon="document"
        style={{ width: 550 }}
      >
        {selectedRecord && (
          <>
            <div className="bp5-dialog-body">
              <Tabs>
                <Tab id="data" title="Data" panel={
                  <div style={{ paddingTop: 16 }}>
                    {attributes.map(attr => (
                      <div key={attr.id} style={{ display: 'flex', marginBottom: 12 }}>
                        <span className="text-muted" style={{ width: 140, fontSize: 13 }}>{attr.name}</span>
                        <span style={{ fontWeight: 500 }}>
                          {String(selectedRecord.data[attr.code] ?? '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                } />
                <Tab id="meta" title="Metadata" panel={
                  <div style={{ paddingTop: 16 }}>
                    <div style={{ display: 'flex', marginBottom: 12 }}>
                      <span className="text-muted" style={{ width: 140, fontSize: 13 }}>Business Key</span>
                      <span>{selectedRecord.business_key}</span>
                    </div>
                    <div style={{ display: 'flex', marginBottom: 12 }}>
                      <span className="text-muted" style={{ width: 140, fontSize: 13 }}>Operation</span>
                      <Tag>{selectedRecord.operation}</Tag>
                    </div>
                    <div style={{ display: 'flex', marginBottom: 12 }}>
                      <span className="text-muted" style={{ width: 140, fontSize: 13 }}>Status</span>
                      <Tag intent={getStatusIntent(selectedRecord.validation_status)}>{selectedRecord.validation_status}</Tag>
                    </div>
                    <div style={{ display: 'flex', marginBottom: 12 }}>
                      <span className="text-muted" style={{ width: 140, fontSize: 13 }}>Created</span>
                      <span>{new Date(selectedRecord.created_at).toLocaleString()} by {selectedRecord.created_by}</span>
                    </div>
                  </div>
                } />
              </Tabs>
            </div>
            <div className="bp5-dialog-footer">
              <div className="bp5-dialog-footer-actions">
                <Button small onClick={() => setSelectedRecord(null)}>Close</Button>
                <Button small icon="edit" onClick={() => { setSelectedRecord(null); handleOpenEdit(selectedRecord); }}>Edit</Button>
              </div>
            </div>
          </>
        )}
      </Dialog>

      {/* Commit Dialog */}
      <Dialog
        isOpen={commitDialogOpen}
        onClose={() => { setCommitDialogOpen(false); setCommitMessage(''); }}
        title="Commit Changes"
        icon="git-commit"
        style={{ width: 450 }}
      >
        <div className="bp5-dialog-body">
          <Callout intent="primary" icon="info-sign" style={{ marginBottom: 15 }}>
            {commitMode === 'selected' 
              ? `You are about to commit ${selectedRecordIds.size} selected record(s).`
              : `You are about to commit ${summary.draft.toLocaleString()} pending change(s).`
            }
          </Callout>
          <FormGroup 
            label="Commit Message" 
            labelFor="commit-message"
            helperText="Optional: Describe the changes being committed"
          >
            <TextArea
              id="commit-message"
              fill
              rows={3}
              placeholder="e.g., Added new customer records"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </FormGroup>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button small onClick={() => { setCommitDialogOpen(false); setCommitMessage(''); }} disabled={isCommitting}>Cancel</Button>
            <Button 
              small
              intent="success" 
              icon="git-commit"
              onClick={handleConfirmCommit}
              loading={isCommitting}
            >
              Commit
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Edit Record Dialog */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditRecord(null); setEditData({}); }}
        title={`Edit Record: ${editRecord?.business_key || ''}`}
        icon="edit"
        style={{ width: 500 }}
      >
        <div className="bp5-dialog-body">
          {attributes.map(attr => (
            <FormGroup 
              key={attr.id} 
              label={attr.name} 
              labelFor={`edit-${attr.code}`}
              labelInfo={attr.is_required ? '(required)' : ''}
              helperText={attr.is_business_key ? 'Business Key' : undefined}
            >
              {renderFieldControl(attr, `edit-${attr.code}`, editData, setEditData)}
            </FormGroup>
          ))}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button small onClick={() => { setIsEditOpen(false); setEditRecord(null); setEditData({}); }} disabled={isEditing}>Cancel</Button>
            <Button 
              small
              intent="primary" 
              onClick={handleEditRecord}
              loading={isEditing}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  )
}
