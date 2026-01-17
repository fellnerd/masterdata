'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Button,
  HTMLTable,
  InputGroup,
  Checkbox,
  Tag,
  NonIdealState,
  Tabs,
  Tab,
  HTMLSelect,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  TextArea,
  Callout
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'

interface HistoryEntry {
  id: number
  entity_id: number
  entity_name: string
  record_key: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_at: string
  changed_by: string
  commit_id: number | null
  commit_code: string | null
  is_committed: boolean
}

interface Entity {
  id: number
  code: string
  name: string
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<string>('all')
  const [selectedOperation, setSelectedOperation] = useState<string>('all')
  const [selectedTab, setSelectedTab] = useState<string>('all')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  
  // Commit Dialog
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitDescription, setCommitDescription] = useState('')
  const [committing, setCommitting] = useState(false)

  // Fetch data
  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const [historyRes, entitiesRes] = await Promise.all([
        fetch('/api/history'),
        fetch('/api/entities')
      ])
      
      if (!historyRes.ok) throw new Error('Failed to fetch history')
      if (!entitiesRes.ok) throw new Error('Failed to fetch entities')
      
      const historyData = await historyRes.json()
      const entitiesData = await entitiesRes.json()
      
      setHistory(historyData)
      // Entities API returns { data: [], total: n }
      setEntities(entitiesData.data || entitiesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Filter history based on all criteria
  const filteredHistory = useMemo(() => {
    return history.filter(entry => {
      // Tab filter
      if (selectedTab === 'uncommitted' && entry.is_committed) return false
      
      // Entity filter
      if (selectedEntity !== 'all' && entry.entity_id.toString() !== selectedEntity) return false
      
      // Operation filter
      if (selectedOperation !== 'all' && entry.operation !== selectedOperation) return false
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesKey = entry.record_key.toLowerCase().includes(query)
        const matchesEntity = entry.entity_name.toLowerCase().includes(query)
        const matchesUser = entry.changed_by.toLowerCase().includes(query)
        if (!matchesKey && !matchesEntity && !matchesUser) return false
      }
      
      return true
    })
  }, [history, selectedTab, selectedEntity, selectedOperation, searchQuery])

  // Calculate KPIs
  const kpis = useMemo(() => {
    const total = filteredHistory.length
    const inserts = filteredHistory.filter(h => h.operation === 'INSERT').length
    const updates = filteredHistory.filter(h => h.operation === 'UPDATE').length
    const deletes = filteredHistory.filter(h => h.operation === 'DELETE').length
    return { total, inserts, updates, deletes }
  }, [filteredHistory])

  // Selection handlers
  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedRows(new Set(filteredHistory.map(h => h.id)))
    } else {
      setSelectedRows(new Set())
    }
  }

  function handleSelectRow(id: number, checked: boolean) {
    const newSelected = new Set(selectedRows)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedRows(newSelected)
  }

  function getOperationIntent(operation: string) {
    switch (operation) {
      case 'INSERT': return 'success'
      case 'UPDATE': return 'warning'
      case 'DELETE': return 'danger'
      default: return 'none'
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  async function handleExport() {
    // TODO: Implement CSV export
    console.log('Export', selectedRows.size > 0 ? Array.from(selectedRows) : 'all')
  }

  // Get uncommitted entries that are selected
  const selectedUncommitted = useMemo(() => {
    return filteredHistory.filter(h => selectedRows.has(h.id) && !h.is_committed)
  }, [filteredHistory, selectedRows])

  // Commit selected changes
  async function handleCommit() {
    if (selectedUncommitted.length === 0) return
    
    setCommitting(true)
    try {
      // Group by entity
      const byEntity = selectedUncommitted.reduce((acc, entry) => {
        if (!acc[entry.entity_id]) {
          acc[entry.entity_id] = []
        }
        acc[entry.entity_id].push(entry.id)
        return acc
      }, {} as Record<number, number[]>)

      // Create commits for each entity
      for (const [entityId, changeIds] of Object.entries(byEntity)) {
        const res = await fetch('/api/commits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity_id: parseInt(entityId),
            change_ids: changeIds,
            description: commitDescription || null
          })
        })
        
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to create commit')
        }
      }

      // Reset and refresh
      setCommitDialogOpen(false)
      setCommitDescription('')
      setSelectedRows(new Set())
      await fetchData()
    } catch (err) {
      console.error('Commit error:', err)
      alert(err instanceof Error ? err.message : 'Fehler beim Committen')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <PageLayout
      title="History"
      breadcrumb={['Data Management', 'History']}
      loading={loading}
      loadingText="Lade Änderungshistorie..."
      error={error}
      onRetry={fetchData}
    >
      {/* KPI Cards */}
      <KpiGrid>
        <KpiCard label="Änderungen gesamt" value={kpis.total} />
        <KpiCard label="Neue Datensätze" value={kpis.inserts} />
        <KpiCard label="Aktualisierungen" value={kpis.updates} />
        <KpiCard label="Löschungen" value={kpis.deletes} />
      </KpiGrid>

      {/* Section Header with Filters */}
      <div className="section-header">
        <h2>Änderungshistorie</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HTMLSelect
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value)}
          >
            <option value="all">Alle Entitäten</option>
            {entities.filter(e => e.name).map(entity => (
              <option key={entity.id} value={entity.id.toString()}>
                {entity.name}
              </option>
            ))}
          </HTMLSelect>
          
          <HTMLSelect
            value={selectedOperation}
            onChange={(e) => setSelectedOperation(e.target.value)}
          >
            <option value="all">Alle Operationen</option>
            <option value="INSERT">Insert</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
          </HTMLSelect>
          
          <InputGroup
            leftIcon="search"
            placeholder="Suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          
          {/* Commit Button - nur wenn uncommitted Einträge ausgewählt */}
          {selectedUncommitted.length > 0 && (
            <Button
              icon="git-commit"
              intent="primary"
              text={`Committen (${selectedUncommitted.length})`}
              onClick={() => setCommitDialogOpen(true)}
            />
          )}
          
          <Button
            icon="export"
            text="Exportieren"
            onClick={handleExport}
            disabled={filteredHistory.length === 0}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        id="history-tabs"
        selectedTabId={selectedTab}
        onChange={(newTab) => setSelectedTab(newTab as string)}
      >
        <Tab id="all" title={`Alle Änderungen (${history.length})`} />
        <Tab id="uncommitted" title={`Nicht committed (${history.filter(h => !h.is_committed).length})`} />
      </Tabs>

      {/* Data Table */}
      <div className="data-table-container" style={{ marginTop: 16 }}>
        {filteredHistory.length === 0 ? (
          <NonIdealState
            icon="history"
            title="Keine Änderungen"
            description="Es wurden keine Änderungen gefunden, die den Filterkriterien entsprechen."
          />
        ) : (
          <HTMLTable striped interactive style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <Checkbox
                    checked={selectedRows.size === filteredHistory.length && filteredHistory.length > 0}
                    indeterminate={selectedRows.size > 0 && selectedRows.size < filteredHistory.length}
                    onChange={(e) => handleSelectAll((e.target as HTMLInputElement).checked)}
                  />
                </th>
                <th style={{ width: 100 }}>Operation</th>
                <th>Entität</th>
                <th>Schlüssel</th>
                <th style={{ width: 100 }}>Status</th>
                <th>Commit</th>
                <th style={{ width: 150 }}>Zeitpunkt</th>
                <th style={{ width: 120 }}>Benutzer</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <Checkbox
                      checked={selectedRows.has(entry.id)}
                      onChange={(e) => handleSelectRow(entry.id, (e.target as HTMLInputElement).checked)}
                    />
                  </td>
                  <td>
                    <Tag intent={getOperationIntent(entry.operation)} minimal>
                      {entry.operation}
                    </Tag>
                  </td>
                  <td>{entry.entity_name}</td>
                  <td>
                    <code>{entry.record_key}</code>
                  </td>
                  <td>
                    {entry.is_committed ? (
                      <Tag intent="success" minimal icon="tick">Committed</Tag>
                    ) : (
                      <Tag intent="warning" minimal icon="time">Pending</Tag>
                    )}
                  </td>
                  <td>
                    {entry.commit_code ? (
                      <Tag minimal>{entry.commit_code}</Tag>
                    ) : (
                      <span style={{ color: '#a7b6c2' }}>-</span>
                    )}
                  </td>
                  <td>{formatDate(entry.changed_at)}</td>
                  <td>{entry.changed_by}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: '#a7b6c2' }}>
          {filteredHistory.length} von {history.length} Einträgen
          {selectedRows.size > 0 && ` (${selectedRows.size} ausgewählt)`}
          {selectedUncommitted.length > 0 && ` - ${selectedUncommitted.length} uncommitted`}
        </span>
        <Button
          icon="refresh"
          text="Aktualisieren"
          onClick={fetchData}
          minimal
        />
      </div>

      {/* Commit Dialog */}
      <Dialog
        isOpen={commitDialogOpen}
        onClose={() => setCommitDialogOpen(false)}
        title="Änderungen committen"
        icon="git-commit"
      >
        <DialogBody>
          <Callout intent="primary" icon="info-sign" style={{ marginBottom: 16 }}>
            <strong>{selectedUncommitted.length} Änderung(en)</strong> werden zu einem Commit zusammengefasst.
            {Object.keys(selectedUncommitted.reduce((acc, e) => ({ ...acc, [e.entity_id]: true }), {})).length > 1 && (
              <div style={{ marginTop: 8 }}>
                <em>Hinweis: Änderungen verschiedener Entitäten werden in separate Commits aufgeteilt.</em>
              </div>
            )}
          </Callout>
          
          <FormGroup label="Beschreibung (optional)" labelFor="commit-desc">
            <TextArea
              id="commit-desc"
              fill
              rows={3}
              placeholder="Beschreibung der Änderungen..."
              value={commitDescription}
              onChange={(e) => setCommitDescription(e.target.value)}
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setCommitDialogOpen(false)} disabled={committing}>
                Abbrechen
              </Button>
              <Button
                intent="primary"
                icon="git-commit"
                onClick={handleCommit}
                loading={committing}
              >
                Committen
              </Button>
            </>
          }
        />
      </Dialog>
    </PageLayout>
  )
}
