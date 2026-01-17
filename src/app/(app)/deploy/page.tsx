'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Button,
  HTMLTable,
  Checkbox,
  Tag,
  NonIdealState,
  Tabs,
  Tab,
  ProgressBar,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'

interface Commit {
  id: number
  code: string
  entity_id: number
  entity_name: string
  record_count: number
  status: 'pending' | 'approved' | 'rejected' | 'deployed'
  created_at: string
  created_by: string
  approved_at: string | null
  approved_by: string | null
  deployed_at: string | null
  deployed_by: string | null
}

interface SchemaDeployment {
  id: number
  entity_id: number
  entity_code: string
  entity_name: string
  model_code: string
  model_name: string
  attribute_count: number
  scd_type: string
  status: 'pending' | 'queued' | 'failed' | 'deployed'
  created_at: string
  updated_at: string | null
  deployed_at: string | null
  deployed_by: string | null
}

interface DeploymentJob {
  id: string
  commitIds: number[]
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  startedAt?: string
  completedAt?: string
  logs: string[]
}

export default function DeployPage() {
  const [commits, setCommits] = useState<Commit[]>([])
  const [schemaDeployments, setSchemaDeployments] = useState<SchemaDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [selectedTab, setSelectedTab] = useState<string>('schema')
  const [selectedCommits, setSelectedCommits] = useState<Set<number>>(new Set())
  const [selectedSchemas, setSelectedSchemas] = useState<Set<number>>(new Set())
  const [showDeployDialog, setShowDeployDialog] = useState(false)
  const [showSchemaDeployDialog, setShowSchemaDeployDialog] = useState(false)
  const [currentJob, setCurrentJob] = useState<DeploymentJob | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [streamLogs, setStreamLogs] = useState<string[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  
  // Deploy-Modus: 'load' = nur mds_load, 'full' = load + master
  const [deployMode, setDeployMode] = useState<'load' | 'full'>('full')
  // Queue Only: Job wird erstellt aber nicht gestartet
  const [queueOnly, setQueueOnly] = useState(false)

  // Fetch commits and schema deployments
  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const [commitsRes, schemaRes] = await Promise.all([
        fetch('/api/commits'),
        fetch('/api/deploy/schema?status=pending,queued,failed')
      ])
      
      if (!commitsRes.ok) throw new Error('Failed to fetch commits')
      if (!schemaRes.ok) throw new Error('Failed to fetch schema deployments')
      
      const commitsData = await commitsRes.json()
      const schemaData = await schemaRes.json()
      
      setCommits(commitsData.data || commitsData)
      setSchemaDeployments(schemaData.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCommits() {
    try {
      const res = await fetch('/api/commits')
      if (!res.ok) throw new Error('Failed to fetch commits')
      const data = await res.json()
      setCommits(data.data || data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  // Filter commits
  const approvedCommits = useMemo(() => 
    commits.filter(c => c.status === 'approved'), [commits])
  
  const deployedCommits = useMemo(() => 
    commits.filter(c => c.status === 'deployed'), [commits])

  // Calculate KPIs
  const kpis = useMemo(() => {
    const readyToDeploy = approvedCommits.length
    const totalRecords = approvedCommits.reduce((sum, c) => sum + (c.record_count || 0), 0)
    const deployedToday = deployedCommits.filter(c => 
      c.deployed_at && new Date(c.deployed_at).toDateString() === new Date().toDateString()
    ).length
    const totalDeployed = deployedCommits.length
    const schemaPending = schemaDeployments.length
    return { readyToDeploy, totalRecords, deployedToday, totalDeployed, schemaPending }
  }, [approvedCommits, deployedCommits, schemaDeployments])

  // Selection handlers for commits
  function handleSelectAll(checked: boolean) {
    const targetCommits = selectedTab === 'approved' ? approvedCommits : deployedCommits
    if (checked) {
      setSelectedCommits(new Set(targetCommits.map(c => c.id)))
    } else {
      setSelectedCommits(new Set())
    }
  }

  function handleSelectRow(id: number, checked: boolean) {
    const newSelected = new Set(selectedCommits)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedCommits(newSelected)
  }

  // Selection handlers for schema deployments
  function handleSelectAllSchemas(checked: boolean) {
    if (checked) {
      setSelectedSchemas(new Set(schemaDeployments.map(s => s.entity_id)))
    } else {
      setSelectedSchemas(new Set())
    }
  }

  function handleSelectSchema(entityId: number, checked: boolean) {
    const newSelected = new Set(selectedSchemas)
    if (checked) {
      newSelected.add(entityId)
    } else {
      newSelected.delete(entityId)
    }
    setSelectedSchemas(newSelected)
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

  // Deploy handler - Uses new Deploy API with dbt integration and SSE streaming
  async function handleDeploy() {
    setShowDeployDialog(false)
    setDeploying(true)
    setStreamLogs([])
    
    const commitIds = Array.from(selectedCommits)
    
    // If queueOnly, show simpler message
    if (queueOnly) {
      setCurrentJob({
        id: `job-${Date.now()}`,
        commitIds,
        status: 'running',
        progress: 0,
        startedAt: new Date().toISOString(),
        logs: [
          '📋 Füge Job zur Queue hinzu...',
          `📋 Modus: ${deployMode === 'full' ? 'Load + Master' : 'Nur Load'}`
        ]
      })
    } else {
      // Start deployment job UI
      setCurrentJob({
        id: `job-${Date.now()}`,
        commitIds,
        status: 'running',
        progress: 0,
        startedAt: new Date().toISOString(),
        logs: [
          '🚀 Starte Data-Deployment...',
          `📋 Modus: ${deployMode === 'full' ? 'Load + Master' : 'Nur Load'}`
        ]
      })
    }

    try {
      // Call Deploy API to create job
      setCurrentJob(prev => prev ? {
        ...prev,
        progress: 10,
        logs: [...prev.logs, queueOnly ? '📦 Erstelle pausierten Job...' : '📦 Erstelle Deployment-Job...']
      } : null)

      const deployRes = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          commit_ids: commitIds,
          deploy_mode: deployMode,  // 'load' or 'full'
          queue_only: queueOnly     // If true, job is paused
        })
      })

      if (!deployRes.ok) {
        const error = await deployRes.json()
        throw new Error(error.error || 'Deploy API failed')
      }

      const deployResult = await deployRes.json()
      
      // Check if there's a job ID to stream
      const jobId = deployResult.job_id
      
      if (!jobId) {
        // No job created (no data to deploy)
        setCurrentJob(prev => prev ? {
          ...prev,
          status: 'completed',
          progress: 100,
          completedAt: new Date().toISOString(),
          logs: [
            ...prev.logs,
            deployResult.message || 'Keine Daten zum Deployen',
            '✅ Fertig'
          ]
        } : null)
        setDeploying(false)
        return
      }

      // If queue_only, show success and don't start SSE stream
      if (queueOnly) {
        setCurrentJob(prev => prev ? {
          ...prev,
          id: jobId,
          status: 'completed',
          progress: 100,
          completedAt: new Date().toISOString(),
          logs: [
            ...prev.logs,
            `✅ ${deployResult.total_records} Datensätze bereit`,
            `📋 Job ${jobId} zur Queue hinzugefügt`,
            '💡 Job kann auf der Jobs-Seite gestartet werden'
          ]
        } : null)
        setDeploying(false)
        setSelectedCommits(new Set())
        setQueueOnly(false) // Reset for next time
        fetchData()
        return
      }

      // Start SSE stream for real-time logs
      setActiveJobId(jobId)
      
      setCurrentJob(prev => prev ? {
        ...prev,
        id: jobId,
        progress: 20,
        logs: [
          ...prev.logs,
          `✅ ${deployResult.total_records} Datensätze bereit`,
          `📊 Job erstellt: ${jobId}`,
          '📡 Verbinde mit Log-Stream...'
        ]
      } : null)

      // Open SSE connection for real-time logs
      const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'log') {
            setStreamLogs(prev => [...prev, data.message])
            setCurrentJob(prev => prev ? {
              ...prev,
              logs: [...prev.logs.slice(-20), data.message]
            } : null)
          } else if (data.type === 'progress') {
            setCurrentJob(prev => prev ? {
              ...prev,
              progress: Math.min(95, Math.max(prev.progress, data.progress || 0)),
              logs: data.message ? [...prev.logs, data.message] : prev.logs
            } : null)
          } else if (data.type === 'completed') {
            setCurrentJob(prev => prev ? {
              ...prev,
              status: 'completed',
              progress: 100,
              completedAt: new Date().toISOString(),
              logs: [...prev.logs, '✅ Data-Deployment erfolgreich!']
            } : null)
            eventSource.close()
            setActiveJobId(null)
            setSelectedCommits(new Set())
            fetchData()
            setDeploying(false)
          } else if (data.type === 'failed') {
            setCurrentJob(prev => prev ? {
              ...prev,
              status: 'failed',
              logs: [...prev.logs, `❌ Fehler: ${data.error}`]
            } : null)
            eventSource.close()
            setActiveJobId(null)
            setDeploying(false)
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err)
        }
      }

      eventSource.onerror = () => {
        console.error('SSE connection error')
        // Check if job completed in background
        setTimeout(async () => {
          await fetchData()
          setCurrentJob(prev => prev ? {
            ...prev,
            status: 'completed',
            progress: 100,
            logs: [...prev.logs, '⚠️ Stream unterbrochen, Job läuft im Hintergrund']
          } : null)
        }, 1000)
        eventSource.close()
        setActiveJobId(null)
        setDeploying(false)
      }

    } catch (err) {
      setCurrentJob(prev => prev ? {
        ...prev,
        status: 'failed',
        logs: [...prev.logs, `❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`]
      } : null)
      setDeploying(false)
    }
  }

  // Schema Deploy handler with SSE streaming
  async function handleSchemaDeploy() {
    setShowSchemaDeployDialog(false)
    setDeploying(true)
    setStreamLogs([])
    
    const entityIds = Array.from(selectedSchemas)
    
    setCurrentJob({
      id: `schema-job-${Date.now()}`,
      commitIds: [],
      status: 'running',
      progress: 0,
      startedAt: new Date().toISOString(),
      logs: ['🚀 Starte Schema-Deployment...']
    })

    try {
      // Step 1: Create job via API
      setCurrentJob(prev => prev ? {
        ...prev,
        progress: 10,
        logs: [...prev.logs, `📦 Deploye ${entityIds.length} Entity(s)...`]
      } : null)

      const res = await fetch('/api/deploy/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: entityIds })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Schema Deploy failed')
      }

      const result = await res.json()
      
      // Check if it's mock mode (no job queue)
      if (result.mode === 'mock') {
        setCurrentJob(prev => prev ? {
          ...prev,
          status: 'completed',
          progress: 100,
          completedAt: new Date().toISOString(),
          logs: [
            ...prev.logs,
            `✅ ${result.deployed_count} Entity(s) deployed (Mock-Modus)`,
            '✅ Entity-Status auf "active" gesetzt'
          ]
        } : null)

        setSelectedSchemas(new Set())
        await fetchData()
        setDeploying(false)
        return
      }

      // Real queue mode: Start SSE stream
      const jobId = result.jobId
      setActiveJobId(jobId)
      
      setCurrentJob(prev => prev ? {
        ...prev,
        id: jobId,
        progress: 20,
        logs: [...prev.logs, `🔄 Job erstellt: ${jobId}`, '📡 Verbinde mit Log-Stream...']
      } : null)

      // Open SSE connection for real-time logs
      const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'log') {
            setStreamLogs(prev => [...prev, data.message])
            setCurrentJob(prev => prev ? {
              ...prev,
              logs: [...prev.logs.slice(-20), data.message] // Keep last 20 logs
            } : null)
          } else if (data.type === 'progress') {
            setCurrentJob(prev => prev ? {
              ...prev,
              progress: Math.min(90, Math.max(prev.progress, data.progress || 0)),
              logs: data.message ? [...prev.logs, data.message] : prev.logs
            } : null)
          } else if (data.type === 'completed') {
            setCurrentJob(prev => prev ? {
              ...prev,
              status: 'completed',
              progress: 100,
              completedAt: new Date().toISOString(),
              logs: [...prev.logs, '✅ Schema-Deployment erfolgreich!']
            } : null)
            eventSource.close()
            setActiveJobId(null)
            setSelectedSchemas(new Set())
            fetchData()
            setDeploying(false)
          } else if (data.type === 'failed') {
            setCurrentJob(prev => prev ? {
              ...prev,
              status: 'failed',
              logs: [...prev.logs, `❌ Fehler: ${data.error}`]
            } : null)
            eventSource.close()
            setActiveJobId(null)
            setDeploying(false)
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err)
        }
      }

      eventSource.onerror = () => {
        console.error('SSE connection error')
        setCurrentJob(prev => prev ? {
          ...prev,
          status: 'failed',
          logs: [...prev.logs, '❌ Verbindung zum Server unterbrochen']
        } : null)
        eventSource.close()
        setActiveJobId(null)
        setDeploying(false)
      }

    } catch (err) {
      setCurrentJob(prev => prev ? {
        ...prev,
        status: 'failed',
        logs: [...prev.logs, `❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`]
      } : null)
      setDeploying(false)
    }
  }

  // Reset queued/failed schema deployments back to pending
  async function handleResetSchemas() {
    const queuedOrFailed = schemaDeployments
      .filter(sd => (sd.status === 'queued' || sd.status === 'failed') && selectedSchemas.has(sd.entity_id))
      .map(sd => sd.entity_id)
    
    if (queuedOrFailed.length === 0) return
    
    try {
      const res = await fetch('/api/deploy/schema', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: queuedOrFailed })
      })
      
      if (!res.ok) throw new Error('Failed to reset status')
      
      await fetchData()
      setSelectedSchemas(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const selectedTotal = useMemo(() => {
    return approvedCommits
      .filter(c => selectedCommits.has(c.id))
      .reduce((sum, c) => sum + (c.record_count || 0), 0)
  }, [approvedCommits, selectedCommits])

  const currentCommits = selectedTab === 'approved' ? approvedCommits : deployedCommits

  return (
    <PageLayout
      title="Deploy"
      breadcrumb={['Operations', 'Deploy']}
      loading={loading}
      loadingText="Lade Deployment-Daten..."
      error={error}
      onRetry={fetchData}
    >
      {/* KPI Cards */}
      <KpiGrid>
        <KpiCard label="Schema-Änderungen" value={kpis.schemaPending} intent={kpis.schemaPending > 0 ? 'warning' : undefined} />
        <KpiCard label="Daten bereit" value={kpis.readyToDeploy} />
        <KpiCard label="Datensätze gesamt" value={kpis.totalRecords} />
        <KpiCard label="Heute deployed" value={kpis.deployedToday} />
        <KpiCard label="Insgesamt deployed" value={kpis.totalDeployed} />
      </KpiGrid>

      {/* Deployment Progress - Enhanced with SSE streaming */}
      {currentJob && currentJob.status === 'running' && (
        <Callout intent="primary" icon="cloud-upload" title="Deployment läuft..." style={{ marginBottom: 16 }}>
          <ProgressBar
            value={currentJob.progress / 100}
            intent="primary"
            animate
            stripes
          />
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray3)' }}>
            {activeJobId && <span>Job ID: {activeJobId}</span>}
          </div>
          <pre style={{ 
            marginTop: 12, 
            background: 'var(--dark-gray5)', 
            padding: 12, 
            borderRadius: 4, 
            maxHeight: 200, 
            overflow: 'auto',
            fontSize: 11,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
            {currentJob.logs.join('\n')}
          </pre>
        </Callout>
      )}

      {/* Deployment Complete */}
      {currentJob && currentJob.status === 'completed' && (
        <Callout intent="success" icon="tick-circle" title="Deployment erfolgreich!" style={{ marginBottom: 16 }}>
          <p style={{ margin: '8px 0' }}>Deployment wurde erfolgreich abgeschlossen.</p>
          {streamLogs.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                Log anzeigen ({streamLogs.length} Zeilen)
              </summary>
              <pre style={{ 
                marginTop: 8, 
                background: 'var(--dark-gray5)', 
                padding: 8, 
                borderRadius: 4, 
                maxHeight: 150,
                overflow: 'auto',
                fontSize: 10
              }}>
                {streamLogs.slice(-30).join('\n')}
              </pre>
            </details>
          )}
          <Button 
            minimal 
            icon="cross" 
            style={{ position: 'absolute', top: 10, right: 10 }}
            onClick={() => { setCurrentJob(null); setStreamLogs([]); }}
          />
        </Callout>
      )}

      {/* Deployment Failed */}
      {currentJob && currentJob.status === 'failed' && (
        <Callout intent="danger" icon="error" title="Deployment fehlgeschlagen" style={{ marginBottom: 16, position: 'relative' }}>
          <pre style={{ fontSize: 12, maxHeight: 150, overflow: 'auto' }}>
            {currentJob.logs.slice(-5).join('\n')}
          </pre>
          {streamLogs.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                Vollständiges Log anzeigen ({streamLogs.length} Zeilen)
              </summary>
              <pre style={{ 
                marginTop: 8, 
                background: 'var(--dark-gray3)', 
                padding: 8, 
                borderRadius: 4, 
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 10
              }}>
                {streamLogs.join('\n')}
              </pre>
            </details>
          )}
          <Button 
            minimal 
            icon="cross" 
            style={{ position: 'absolute', top: 10, right: 10 }}
            onClick={() => { setCurrentJob(null); setStreamLogs([]); }}
          />
        </Callout>
      )}

      {/* Info Callout */}
      {selectedTab === 'schema' && schemaDeployments.length > 0 && selectedSchemas.size === 0 && (
        <Callout intent="warning" icon="info-sign" style={{ marginBottom: 16 }}>
          <strong>{schemaDeployments.length} Schema-Änderung(en) bereit</strong> - Wählen Sie 
          Entities aus und klicken Sie auf &quot;Schema deployen&quot; um die Strukturänderungen zu aktivieren.
        </Callout>
      )}
      {selectedTab !== 'schema' && approvedCommits.length > 0 && selectedCommits.size === 0 && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 16 }}>
          <strong>{approvedCommits.length} Commit(s) bereit zum Deployment</strong> - Wählen Sie 
          Commits aus und klicken Sie auf &quot;Deploy ausgewählte&quot; um die Änderungen in den Data Vault zu übertragen.
        </Callout>
      )}

      {/* Section Header */}
      <div className="section-header">
        <h2>Deployment Queue</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedTab === 'schema' ? (
            <>
              <Button
                icon="data-lineage"
                intent="warning"
                text={`Schema deployen (${selectedSchemas.size})`}
                disabled={selectedSchemas.size === 0 || deploying}
                onClick={() => setShowSchemaDeployDialog(true)}
              />
              {/* Reset button for queued/failed entries */}
              {schemaDeployments.some(sd => (sd.status === 'queued' || sd.status === 'failed') && selectedSchemas.has(sd.entity_id)) && (
                <Button
                  icon="reset"
                  intent="none"
                  text="Zurücksetzen"
                  onClick={handleResetSchemas}
                  title="Ausgewählte queued/failed Einträge auf pending zurücksetzen"
                />
              )}
            </>
          ) : (
            <Button
              icon="cloud-upload"
              intent="primary"
              text={`Deploy ausgewählte (${selectedCommits.size})`}
              disabled={selectedCommits.size === 0 || deploying}
              onClick={() => setShowDeployDialog(true)}
            />
          )}
          <Button
            icon="refresh"
            text="Aktualisieren"
            onClick={fetchData}
            minimal
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        id="deploy-tabs"
        selectedTabId={selectedTab}
        onChange={(newTab) => {
          setSelectedTab(newTab as string)
          setSelectedCommits(new Set())
          setSelectedSchemas(new Set())
        }}
      >
        <Tab id="schema" title={`Schema (${schemaDeployments.length})`} />
        <Tab id="approved" title={`Daten (${approvedCommits.length})`} />
        <Tab id="deployed" title={`Deployed (${deployedCommits.length})`} />
      </Tabs>

      {/* Data Table */}
      <div className="data-table-container" style={{ marginTop: 16 }}>
        {/* Schema Deployments Tab */}
        {selectedTab === 'schema' && (
          schemaDeployments.length === 0 ? (
            <NonIdealState
              icon="data-lineage"
              title="Keine Schema-Änderungen"
              description="Es gibt keine ausstehenden Schema-Änderungen zum Deployen."
            />
          ) : (
            <HTMLTable striped interactive style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <Checkbox
                      checked={selectedSchemas.size === schemaDeployments.length && schemaDeployments.length > 0}
                      indeterminate={selectedSchemas.size > 0 && selectedSchemas.size < schemaDeployments.length}
                      onChange={(e) => handleSelectAllSchemas((e.target as HTMLInputElement).checked)}
                    />
                  </th>
                  <th>Entity</th>
                  <th>Model</th>
                  <th style={{ width: 100 }}>Attribute</th>
                  <th style={{ width: 80 }}>SCD-Typ</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th>Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {schemaDeployments.map(sd => (
                  <tr key={sd.id}>
                    <td>
                      <Checkbox
                        checked={selectedSchemas.has(sd.entity_id)}
                        onChange={(e) => handleSelectSchema(sd.entity_id, (e.target as HTMLInputElement).checked)}
                      />
                    </td>
                    <td>
                      <div><strong>{sd.entity_name}</strong></div>
                      <small style={{ color: 'var(--gray3)' }}>{sd.entity_code}</small>
                    </td>
                    <td>
                      <div>{sd.model_name}</div>
                      <small style={{ color: 'var(--gray3)' }}>{sd.model_code}</small>
                    </td>
                    <td>{sd.attribute_count}</td>
                    <td>
                      <Tag minimal>{sd.scd_type}</Tag>
                    </td>
                    <td>
                      <Tag 
                        intent={sd.status === 'pending' ? 'warning' : sd.status === 'queued' ? 'primary' : 'danger'} 
                        minimal
                      >
                        {sd.status === 'queued' ? 'in Warteschlange' : sd.status === 'failed' ? 'fehlgeschlagen' : sd.status}
                      </Tag>
                    </td>
                    <td>{formatDate(sd.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          )
        )}

        {/* Data Commits Tab */}
        {selectedTab !== 'schema' && (
          currentCommits.length === 0 ? (
          <NonIdealState
            icon={selectedTab === 'approved' ? 'inbox' : 'cloud-upload'}
            title={selectedTab === 'approved' ? 'Keine Commits bereit' : 'Noch keine Deployments'}
            description={selectedTab === 'approved' 
              ? 'Es gibt keine genehmigten Commits, die deployed werden können.'
              : 'Es wurden noch keine Commits deployed.'
            }
          />
        ) : (
          <HTMLTable striped interactive style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <Checkbox
                    checked={selectedCommits.size === currentCommits.length && currentCommits.length > 0}
                    indeterminate={selectedCommits.size > 0 && selectedCommits.size < currentCommits.length}
                    onChange={(e) => handleSelectAll((e.target as HTMLInputElement).checked)}
                    disabled={selectedTab === 'deployed'}
                  />
                </th>
                <th>Commit-Code</th>
                <th>Entität</th>
                <th style={{ width: 100 }}>Datensätze</th>
                <th style={{ width: 100 }}>Status</th>
                <th>Erstellt</th>
                <th>Genehmigt</th>
                {selectedTab === 'deployed' && <th>Deployed</th>}
              </tr>
            </thead>
            <tbody>
              {currentCommits.map(commit => (
                <tr key={commit.id}>
                  <td>
                    <Checkbox
                      checked={selectedCommits.has(commit.id)}
                      onChange={(e) => handleSelectRow(commit.id, (e.target as HTMLInputElement).checked)}
                      disabled={selectedTab === 'deployed'}
                    />
                  </td>
                  <td><code>{commit.code}</code></td>
                  <td>{commit.entity_name}</td>
                  <td>{commit.record_count || 0}</td>
                  <td>
                    <Tag 
                      intent={commit.status === 'deployed' ? 'primary' : 'success'} 
                      minimal
                    >
                      {commit.status}
                    </Tag>
                  </td>
                  <td>
                    <div>{formatDate(commit.created_at)}</div>
                    <small style={{ color: 'var(--gray3)' }}>{commit.created_by}</small>
                  </td>
                  <td>
                    {commit.approved_at ? (
                      <>
                        <div>{formatDate(commit.approved_at)}</div>
                        <small style={{ color: 'var(--gray3)' }}>{commit.approved_by}</small>
                      </>
                    ) : '-'}
                  </td>
                  {selectedTab === 'deployed' && (
                    <td>
                      {commit.deployed_at ? (
                        <>
                          <div>{formatDate(commit.deployed_at)}</div>
                          <small style={{ color: 'var(--gray3)' }}>{commit.deployed_by}</small>
                        </>
                      ) : '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: '#a7b6c2' }}>
          {selectedTab === 'schema' 
            ? `${schemaDeployments.length} Schema-Änderung(en)${selectedSchemas.size > 0 ? ` (${selectedSchemas.size} ausgewählt)` : ''}`
            : `${currentCommits.length} Commit(s)${selectedCommits.size > 0 ? ` (${selectedCommits.size} ausgewählt, ${selectedTotal} Datensätze)` : ''}`
          }
        </span>
      </div>

      {/* Schema Deploy Confirmation Dialog */}
      <Dialog
        isOpen={showSchemaDeployDialog}
        onClose={() => setShowSchemaDeployDialog(false)}
        title="Schema-Deployment bestätigen"
        icon="data-lineage"
      >
        <DialogBody>
          <p>Möchten Sie die folgenden Schema-Änderungen deployen?</p>
          <ul>
            <li><strong>{selectedSchemas.size}</strong> Entity(s)</li>
          </ul>
          <Callout intent="primary" icon="info-sign">
            Nach dem Deploy werden die Entities auf <strong>&quot;active&quot;</strong> gesetzt und 
            können Daten empfangen.
          </Callout>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setShowSchemaDeployDialog(false)}>Abbrechen</Button>
              <Button intent="warning" icon="data-lineage" onClick={handleSchemaDeploy}>
                Ja, Schema deployen
              </Button>
            </>
          }
        />
      </Dialog>

      {/* Deploy Confirmation Dialog */}
      <Dialog
        isOpen={showDeployDialog}
        onClose={() => setShowDeployDialog(false)}
        title="Deployment bestätigen"
        icon="cloud-upload"
      >
        <DialogBody>
          <p>Möchten Sie die folgenden Änderungen deployen?</p>
          <ul>
            <li><strong>{selectedCommits.size}</strong> Commit(s)</li>
            <li><strong>{selectedTotal}</strong> Datensätze</li>
          </ul>
          
          {/* Deploy Mode Selection */}
          <div style={{ marginTop: 16, marginBottom: 16, padding: 12, background: 'var(--dark-gray4)', borderRadius: 4 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Deploy-Modus:</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="deployMode"
                  value="full"
                  checked={deployMode === 'full'}
                  onChange={() => setDeployMode('full')}
                  style={{ marginRight: 6 }}
                />
                <span><strong>Load + Master</strong> (Empfohlen)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="deployMode"
                  value="load"
                  checked={deployMode === 'load'}
                  onChange={() => setDeployMode('load')}
                  style={{ marginRight: 6 }}
                />
                <span><strong>Nur Load</strong></span>
              </label>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray3)' }}>
              {deployMode === 'full' 
                ? '📊 Daten werden in mds_load geladen UND nach mds_master übertragen (SCD2 historisiert)'
                : '📦 Daten werden nur in mds_load geladen (für manuelle Weiterverarbeitung)'
              }
            </div>
          </div>
          
          <Callout intent="warning" icon="warning-sign">
            Dieser Vorgang kann nicht rückgängig gemacht werden. Die Daten werden 
            permanent übertragen.
          </Callout>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setShowDeployDialog(false)}>Abbrechen</Button>
              <Button 
                intent="none" 
                icon="time" 
                onClick={() => { setQueueOnly(true); handleDeploy(); }}
                title="Job zur Queue hinzufügen ohne sofort zu starten"
              >
                Zur Queue
              </Button>
              <Button intent="primary" icon="cloud-upload" onClick={() => { setQueueOnly(false); handleDeploy(); }}>
                Jetzt deployen
              </Button>
            </>
          }
        />
      </Dialog>
    </PageLayout>
  )
}
