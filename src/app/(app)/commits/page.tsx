'use client'

import { useState, useEffect } from 'react'
import {
  Button,
  HTMLTable,
  Tag,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  TextArea,
  Tabs,
  Tab,
  Card,
  Icon,
  Callout,
  Collapse,
  IconName,
  Spinner,
  NonIdealState,
  ProgressBar
} from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard'

interface Commit {
  id: number
  code: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'deployed'
  entity_id: number
  entity_name?: string
  record_count: number
  created_at: string
  created_by: string
  approved_at?: string | null
  approved_by?: string | null
  rejected_at?: string | null
  rejected_by?: string | null
  rejection_reason?: string | null
  deployed_at?: string | null
  deployed_by?: string | null
}

interface Summary {
  total: number
  pending: number
  approved: number
  rejected: number
  deployed: number
}

interface CommitRecord {
  id: number
  business_key: string
  operation: string
  status: string
  data: Record<string, unknown>
  previousData: Record<string, unknown> | null
  created_at: string
  created_by: string
}

export default function CommitsPage() {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary>({ total: 0, pending: 0, approved: 0, rejected: 0, deployed: 0 })
  const [selectedTab, setSelectedTab] = useState<string>('pending')
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [expandedCommits, setExpandedCommits] = useState<Set<number>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  
  // Deploy Dialog State
  const [deployDialogOpen, setDeployDialogOpen] = useState(false)
  const [deployCommit, setDeployCommit] = useState<Commit | null>(null)
  const [deployMode, setDeployMode] = useState<'load' | 'full'>('full')
  const [queueOnly, setQueueOnly] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployProgress, setDeployProgress] = useState(0)
  const [deployLogs, setDeployLogs] = useState<string[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  // Fetch commits from API
  const fetchCommits = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/commits')
      if (!res.ok) throw new Error('Failed to load commits')
      const json = await res.json()
      setCommits(json.data || [])
      setSummary(json.summary || { total: 0, pending: 0, approved: 0, rejected: 0, deployed: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commits')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCommits()
  }, [])

  const pendingCommits = commits.filter(c => c.status === 'pending')
  const approvedCommits = commits.filter(c => c.status === 'approved')
  const deployedCommits = commits.filter(c => c.status === 'deployed')
  const rejectedCommits = commits.filter(c => c.status === 'rejected')

  const getStatusIntent = (status: Commit['status']) => {
    switch (status) {
      case 'pending': return 'warning'
      case 'approved': return 'success'
      case 'rejected': return 'danger'
      case 'deployed': return 'primary'
    }
  }

  const handleApprove = async () => {
    if (!selectedCommit) return
    try {
      setActionLoading(true)
      const res = await fetch('/api/commits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedCommit.id,
          action: 'approve',
          comment: reviewComment
        })
      })
      if (!res.ok) throw new Error('Failed to approve commit')
      await fetchCommits()
      setReviewDialogOpen(false)
      setSelectedCommit(null)
      setReviewComment('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!selectedCommit) return
    try {
      setActionLoading(true)
      const res = await fetch('/api/commits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedCommit.id,
          action: 'reject',
          comment: reviewComment
        })
      })
      if (!res.ok) throw new Error('Failed to reject commit')
      await fetchCommits()
      setReviewDialogOpen(false)
      setSelectedCommit(null)
      setReviewComment('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setActionLoading(false)
    }
  }

  // Open deploy dialog
  const handleDeploy = (commit: Commit) => {
    setDeployCommit(commit)
    setDeployMode('full')
    setDeployLogs([])
    setDeployProgress(0)
    setDeploying(false)
    setActiveJobId(null)
    setDeployDialogOpen(true)
  }

  // Execute deployment with SSE streaming
  const handleDeployConfirm = async (useQueueOnly = false) => {
    if (!deployCommit) return
    
    setDeploying(true)
    setDeployProgress(5)
    
    if (useQueueOnly) {
      setDeployLogs([
        '📋 Füge Job zur Queue hinzu...',
        `📋 Modus: ${deployMode === 'full' ? 'Load + Master' : 'Nur Load'}`,
        `📦 Commit: ${deployCommit.code}`
      ])
    } else {
      setDeployLogs([
        '🚀 Starte Data-Deployment...',
        `📋 Modus: ${deployMode === 'full' ? 'Load + Master' : 'Nur Load'}`,
        `📦 Commit: ${deployCommit.code}`
      ])
    }

    try {
      // Call Deploy API
      setDeployProgress(10)
      setDeployLogs(prev => [...prev, useQueueOnly ? '📦 Erstelle pausierten Job...' : '📦 Erstelle Deployment-Job...'])

      const deployRes = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commit_ids: [deployCommit.id],
          deploy_mode: deployMode,
          queue_only: useQueueOnly
        })
      })

      if (!deployRes.ok) {
        const error = await deployRes.json()
        throw new Error(error.error || 'Deploy API failed')
      }

      const deployResult = await deployRes.json()
      const jobId = deployResult.job_id

      if (!jobId) {
        // No job created
        setDeployLogs(prev => [...prev, '✅ ' + (deployResult.message || 'Fertig')])
        setDeployProgress(100)
        setTimeout(() => {
          setDeployDialogOpen(false)
          fetchCommits()
        }, 1500)
        return
      }

      // If queue_only, show success and close dialog
      if (useQueueOnly) {
        setDeployProgress(100)
        setDeployLogs(prev => [
          ...prev,
          `✅ ${deployResult.total_records} Datensätze bereit`,
          `📋 Job ${jobId} zur Queue hinzugefügt`,
          '💡 Job kann auf der Jobs-Seite gestartet werden'
        ])
        setTimeout(() => {
          setDeployDialogOpen(false)
          setQueueOnly(false)
          fetchCommits()
        }, 2000)
        setDeploying(false)
        return
      }

      // Start SSE stream
      setActiveJobId(jobId)
      setDeployProgress(20)
      setDeployLogs(prev => [
        ...prev,
        `✅ ${deployResult.total_records} Datensätze bereit`,
        `📊 Job erstellt: ${jobId}`,
        '📡 Verbinde mit Log-Stream...'
      ])

      const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'log') {
            setDeployLogs(prev => [...prev.slice(-30), data.message])
          } else if (data.type === 'progress') {
            setDeployProgress(Math.min(95, data.progress || 0))
            if (data.message) {
              setDeployLogs(prev => [...prev.slice(-30), data.message])
            }
          } else if (data.type === 'completed') {
            setDeployProgress(100)
            setDeployLogs(prev => [...prev, '✅ Data-Deployment erfolgreich!'])
            eventSource.close()
            setActiveJobId(null)
            setDeploying(false)
            setTimeout(() => {
              setDeployDialogOpen(false)
              fetchCommits()
            }, 2000)
          } else if (data.type === 'failed') {
            setDeployLogs(prev => [...prev, `❌ Fehler: ${data.error}`])
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
        setDeployLogs(prev => [...prev, '⚠️ Stream unterbrochen, Job läuft im Hintergrund'])
        eventSource.close()
        setActiveJobId(null)
        setDeploying(false)
        setTimeout(() => {
          setDeployDialogOpen(false)
          fetchCommits()
        }, 2000)
      }

    } catch (err) {
      setDeployLogs(prev => [...prev, `❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`])
      setDeploying(false)
    }
  }

  const toggleExpand = async (commitId: number) => {
    const newExpanded = new Set(expandedCommits)
    if (newExpanded.has(commitId)) {
      newExpanded.delete(commitId)
    } else {
      newExpanded.add(commitId)
      // Load records for this commit if not already loaded
      if (!commitRecords[commitId]) {
        await loadCommitRecords(commitId)
      }
    }
    setExpandedCommits(newExpanded)
  }

  // State for commit records
  const [commitRecords, setCommitRecords] = useState<Record<number, CommitRecord[]>>({})
  const [recordsLoading, setRecordsLoading] = useState<Set<number>>(new Set())

  const loadCommitRecords = async (commitId: number) => {
    try {
      setRecordsLoading(prev => new Set(prev).add(commitId))
      const res = await fetch(`/api/commits/${commitId}/records`)
      if (!res.ok) throw new Error('Failed to load records')
      const json = await res.json()
      setCommitRecords(prev => ({ ...prev, [commitId]: json.data || [] }))
    } catch (err) {
      console.error('Failed to load commit records:', err)
    } finally {
      setRecordsLoading(prev => {
        const newSet = new Set(prev)
        newSet.delete(commitId)
        return newSet
      })
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

  const getFilteredCommits = () => {
    switch (selectedTab) {
      case 'pending': return pendingCommits
      case 'approved': return approvedCommits
      case 'deployed': return deployedCommits
      case 'rejected': return rejectedCommits
      default: return commits
    }
  }

  const CommitCard = ({ commit }: { commit: Commit }) => (
    <Card 
      className="commit-card"
      style={{ marginBottom: 12, padding: 0 }}
    >
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '12px 16px',
          cursor: 'pointer'
        }}
        onClick={() => toggleExpand(commit.id)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon 
            icon={expandedCommits.has(commit.id) ? 'chevron-down' : 'chevron-right'} 
            size={16}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{commit.code}</strong>
              <Tag minimal intent={getStatusIntent(commit.status)}>
                {commit.status}
              </Tag>
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {commit.description || `${commit.record_count} records for ${commit.entity_name || 'Unknown Entity'}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11 }}>
          <div className="text-muted">
            <Icon icon="user" size={12} /> {commit.created_by}
          </div>
          <div className="text-muted">
            <Icon icon="time" size={12} /> {formatDate(commit.created_at)}
          </div>
          <Tag minimal>
            {commit.record_count} records
          </Tag>
        </div>
      </div>
      
      <Collapse isOpen={expandedCommits.has(commit.id)}>
        <div style={{ 
          borderTop: '1px solid var(--border-color, #e1e8ed)', 
          padding: 16,
          background: 'var(--card-bg-secondary, #f5f8fa)'
        }}>
          {/* Commit Details */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 12 }}>Details</h4>
            <div style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <span className="text-muted">Entity:</span> {commit.entity_name || 'Unknown'}
              </div>
              <div style={{ marginBottom: 4 }}>
                <span className="text-muted">Records:</span> {commit.record_count}
              </div>
              <div style={{ marginBottom: 4 }}>
                <span className="text-muted">Created:</span> {formatDate(commit.created_at)} by {commit.created_by}
              </div>
            </div>
          </div>

          {/* Record Changes */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 12 }}>Changes</h4>
            {recordsLoading.has(commit.id) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <Spinner size={14} /> Loading records...
              </div>
            ) : commitRecords[commit.id] && commitRecords[commit.id].length > 0 ? (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Operation</th>
                      <th style={{ width: 100 }}>Business Key</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commitRecords[commit.id].map(record => (
                      <tr key={record.id}>
                        <td>
                          <Tag 
                            minimal 
                            intent={
                              record.operation === 'INSERT' ? 'success' : 
                              record.operation === 'UPDATE' ? 'warning' : 
                              record.operation === 'DELETE' ? 'danger' : 'none'
                            }
                          >
                            {record.operation}
                          </Tag>
                        </td>
                        <td><code>{record.business_key}</code></td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {record.data && Object.entries(record.data).map(([key, value]) => (
                              <Tag key={key} minimal style={{ fontSize: 10 }}>
                                <span className="text-muted">{key}:</span> {String(value)}
                              </Tag>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </HTMLTable>
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: 12 }}>No records found</div>
            )}
          </div>

          {/* Approval Info */}
          {commit.approved_at && (
            <Callout intent="success" icon="tick" style={{ marginBottom: 12 }}>
              <strong>Approved</strong> by {commit.approved_by} on {formatDate(commit.approved_at)}
            </Callout>
          )}

          {/* Rejection Info */}
          {commit.rejected_at && (
            <Callout intent="danger" icon="cross" style={{ marginBottom: 12 }}>
              <strong>Rejected</strong> by {commit.rejected_by} on {formatDate(commit.rejected_at)}
              {commit.rejection_reason && <div style={{ marginTop: 4 }}>{commit.rejection_reason}</div>}
            </Callout>
          )}

          {/* Deploy Info */}
          {commit.deployed_at && (
            <Callout intent="primary" icon="cloud-upload" style={{ marginBottom: 12 }}>
              <strong>Deployed</strong> by {commit.deployed_by} on {formatDate(commit.deployed_at)}
            </Callout>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {commit.status === 'pending' && (
              <Button 
                small 
                icon="eye-open"
                loading={actionLoading}
                onClick={(e) => { e.stopPropagation(); setSelectedCommit(commit); setReviewDialogOpen(true); }}
              >
                Review
              </Button>
            )}
            {commit.status === 'approved' && (
              <Button 
                small 
                intent="primary"
                icon="cloud-upload"
                loading={actionLoading}
                onClick={(e) => { e.stopPropagation(); handleDeploy(commit); }}
              >
                Deploy to Data Vault
              </Button>
            )}
          </div>
        </div>
      </Collapse>
    </Card>
  )

  return (
    <PageLayout
      title="Commits"
      breadcrumb={['Data Management', 'Commits']}
      loading={loading}
      loadingText="Lade Commits..."
      error={error}
      onRetry={fetchCommits}
    >
      {/* Stats */}
      <KpiGrid>
        <KpiCard label="Pending Review" value={summary.pending} intent="warning" />
        <KpiCard label="Approved" value={summary.approved} intent="success" />
        <KpiCard label="Deployed" value={summary.deployed} intent="primary" />
        <KpiCard label="Rejected" value={summary.rejected} intent="danger" />
      </KpiGrid>

      {/* Tabs */}
      <div className="section-header">
        <h2>Commit Queue</h2>
      </div>

      <Tabs 
        id="commit-tabs" 
        selectedTabId={selectedTab} 
        onChange={(newTab) => setSelectedTab(newTab as string)}
        large={false}
      >
        <Tab id="pending" title={`Pending Review (${pendingCommits.length})`} />
        <Tab id="approved" title={`Ready to Deploy (${approvedCommits.length})`} />
        <Tab id="deployed" title={`Deployed (${deployedCommits.length})`} />
        <Tab id="rejected" title={`Rejected (${rejectedCommits.length})`} />
      </Tabs>

      <div style={{ marginTop: 16 }}>
        {getFilteredCommits().length === 0 ? (
          <NonIdealState
            icon="inbox"
            title="No commits"
            description={`No ${selectedTab} commits found.`}
          />
        ) : (
          getFilteredCommits().map(commit => (
            <CommitCard key={commit.id} commit={commit} />
          ))
        )}
      </div>

      {/* Review Dialog */}
      <Dialog
        isOpen={reviewDialogOpen}
        onClose={() => setReviewDialogOpen(false)}
        title={`Review: ${selectedCommit?.code}`}
        icon="eye-open"
        style={{ width: 500 }}
      >
        <div className="bp5-dialog-body">
          {selectedCommit && (
            <>
              <Callout intent="none" icon="info-sign" style={{ marginBottom: 16 }}>
                <strong>{selectedCommit.entity_name}</strong>: {selectedCommit.record_count} records
                <div className="text-muted" style={{ marginTop: 4 }}>
                  Created by {selectedCommit.created_by} on {formatDate(selectedCommit.created_at)}
                </div>
              </Callout>

              <FormGroup label="Review Comment" labelFor="review-comment">
                <TextArea
                  id="review-comment"
                  fill
                  rows={3}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Add a comment for this review..."
                />
              </FormGroup>
            </>
          )}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
            <Button 
              intent="danger" 
              icon="cross"
              loading={actionLoading}
              onClick={handleReject}
            >
              Reject
            </Button>
            <Button 
              intent="success" 
              icon="tick"
              loading={actionLoading}
              onClick={handleApprove}
            >
              Approve
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Deploy Dialog with Mode Selection and SSE Streaming */}
      <Dialog
        isOpen={deployDialogOpen}
        onClose={() => setDeployDialogOpen(false)}
        title={deploying ? "Deployment läuft..." : "Deploy to Data Vault"}
        icon="cloud-upload"
        style={{ width: 600 }}
        canOutsideClickClose={!deploying}
        canEscapeKeyClose={true}
      >
        <DialogBody>
          {!deploying ? (
            <>
              {/* Commit Info */}
              {deployCommit && (
                <Callout intent="none" icon="info-sign" style={{ marginBottom: 16 }}>
                  <strong>{deployCommit.entity_name}</strong>: {deployCommit.record_count} Datensätze
                  <div style={{ marginTop: 4, color: 'var(--gray3)' }}>
                    Commit: <code>{deployCommit.code}</code>
                  </div>
                </Callout>
              )}

              {/* Deploy Mode Selection */}
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--dark-gray4)', borderRadius: 4 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>Deploy-Modus:</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="deployMode"
                      value="full"
                      checked={deployMode === 'full'}
                      onChange={() => setDeployMode('full')}
                      style={{ marginRight: 8 }}
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
                      style={{ marginRight: 8 }}
                    />
                    <span><strong>Nur Load</strong></span>
                  </label>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray3)' }}>
                  {deployMode === 'full'
                    ? '📊 Daten werden in mds_load geladen UND nach mds_master übertragen (SCD2 historisiert)'
                    : '📦 Daten werden nur in mds_load geladen (für manuelle Weiterverarbeitung)'}
                </div>
              </div>

              <Callout intent="warning" icon="warning-sign">
                Dieser Vorgang kann nicht rückgängig gemacht werden.
              </Callout>
            </>
          ) : (
            <>
              {/* Progress Display */}
              <div style={{ marginBottom: 16 }}>
                <ProgressBar
                  value={deployProgress / 100}
                  intent={deployProgress === 100 ? 'success' : 'primary'}
                  animate={deployProgress < 100}
                  stripes={deployProgress < 100}
                />
                {activeJobId && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray3)' }}>
                    Job ID: {activeJobId}
                  </div>
                )}
              </div>

              {/* Live Logs */}
              <pre style={{
                background: 'var(--dark-gray5)',
                padding: 12,
                borderRadius: 4,
                maxHeight: 250,
                overflow: 'auto',
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {deployLogs.join('\n')}
              </pre>
            </>
          )}
        </DialogBody>
        <DialogFooter
          actions={
            deploying ? (
              <>
                <Button onClick={() => setDeployDialogOpen(false)}>
                  Schließen (läuft im Hintergrund)
                </Button>
                {activeJobId && (
                  <Button 
                    intent="primary" 
                    icon="application" 
                    onClick={() => {
                      setDeployDialogOpen(false)
                      window.location.href = '/jobs'
                    }}
                  >
                    Zu Jobs
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button onClick={() => setDeployDialogOpen(false)}>Abbrechen</Button>
                <Button 
                  intent="none" 
                  icon="time" 
                  onClick={() => handleDeployConfirm(true)}
                  title="Job zur Queue hinzufügen ohne sofort zu starten"
                >
                  Zur Queue
                </Button>
                <Button intent="primary" icon="cloud-upload" onClick={() => handleDeployConfirm(false)}>
                  Jetzt deployen
                </Button>
              </>
            )
          }
        />
      </Dialog>
    </PageLayout>
  )
}
