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
  Checkbox,
  Tabs,
  Tab,
  Spinner,
  NonIdealState,
  Callout,
  Icon,
  TextArea
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'
import { SectionHeader } from '@/components/ui/SectionHeader'

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

export default function DataEntryPage() {
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

  // Fetch entities on mount
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const res = await fetch('/api/entities')
        if (!res.ok) throw new Error('Failed to load entities')
        const json = await res.json()
        setEntities(json.data || [])
        if (json.data?.length > 0) {
          setSelectedEntityId(json.data[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entities')
      } finally {
        setLoading(false)
      }
    }
    fetchEntities()
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

  // Fetch records when entity, page or pageSize changes
  useEffect(() => {
    if (!selectedEntityId) return
    
    const fetchRecords = async () => {
      try {
        setLoading(true)
        const recordsRes = await fetch(`/api/records?entity_id=${selectedEntityId}&page=${currentPage}&pageSize=${pageSize}`)
        
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
  }, [selectedEntityId, currentPage, pageSize])

  // Helper function to refresh records
  const refreshRecords = async () => {
    const recordsRes = await fetch(`/api/records?entity_id=${selectedEntityId}&page=${currentPage}&pageSize=${pageSize}`)
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
              onChange={(e) => setSelectedEntityId(Number(e.target.value))}
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
                {attributes.slice(0, 4).map(attr => (
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
                  {attributes.slice(0, 4).map(attr => (
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
              <InputGroup
                id={attr.code}
                type={attr.data_type === 'integer' || attr.data_type === 'decimal' ? 'number' : 'text'}
                placeholder={`Enter ${attr.name.toLowerCase()}`}
                value={String(newRecord[attr.code] ?? '')}
                onChange={(e) => setNewRecord({ 
                  ...newRecord, 
                  [attr.code]: attr.data_type === 'integer' ? parseInt(e.target.value) || '' :
                               attr.data_type === 'decimal' ? parseFloat(e.target.value) || '' :
                               e.target.value 
                })}
                intent={attr.is_business_key ? 'primary' : 'none'}
              />
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
              <InputGroup
                id={`edit-${attr.code}`}
                type={attr.data_type === 'integer' || attr.data_type === 'decimal' ? 'number' : 'text'}
                placeholder={`Enter ${attr.name.toLowerCase()}`}
                value={String(editData[attr.code] ?? '')}
                onChange={(e) => setEditData({ 
                  ...editData, 
                  [attr.code]: attr.data_type === 'integer' ? parseInt(e.target.value) || '' :
                               attr.data_type === 'decimal' ? parseFloat(e.target.value) || '' :
                               e.target.value 
                })}
                intent={attr.is_business_key ? 'primary' : 'none'}
              />
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
