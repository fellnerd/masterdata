'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Tag,
  Card,
  Icon,
  ProgressBar,
  Callout,
  Spinner,
  Collapse,
  Dialog,
  NonIdealState,
  InputGroup,
  HTMLSelect,
  ButtonGroup,
  Tabs,
  Tab
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'
import { useJobsWithPagination, useCancelJob, useRetryJob, useBulkRetry, useBulkCancel, useBulkRemove, type Job, type JobType } from '@/hooks/useJobs'
import { usePromoteJob } from '@/hooks/useJob'
import { useMultipleJobStreams, type JobStreamState } from '@/hooks/useJobStream'
import { WorkerStatus } from '@/components/jobs/WorkerStatus'
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog'
import { JobMetricsCard } from '@/components/jobs/JobMetrics'
import { CreateScheduleDialog } from '@/components/jobs/CreateScheduleDialog'
import { SchedulesList } from '@/components/jobs/SchedulesList'

// Helper to normalize status from BullMQ to UI
const normalizeStatus = (status: string): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' => {
  switch (status) {
    case 'active': return 'running'
    case 'waiting':
    case 'delayed': return 'queued'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    default: return 'queued'
  }
}

// German status labels
const getStatusLabel = (status: string, originalStatus?: string): string => {
  // Show "pausiert" for delayed jobs
  if (originalStatus === 'delayed') return 'pausiert'
  
  switch (normalizeStatus(status)) {
    case 'running': return 'läuft'
    case 'queued': return 'wartend'
    case 'completed': return 'fertig'
    case 'failed': return 'fehler'
    case 'cancelled': return 'abgebrochen'
    default: return status
  }
}

export default function JobsPage() {
  const router = useRouter()
  
  // API hooks
  const { 
    data: jobsData, 
    isLoading, 
    error, 
    refetch,
    loadMore,
    hasMore,
    currentLimit,
    totalJobs
  } = useJobsWithPagination(20)
  const cancelJobMutation = useCancelJob()
  const retryJobMutation = useRetryJob()
  const promoteJobMutation = usePromoteJob()
  const bulkRetryMutation = useBulkRetry()
  const bulkCancelMutation = useBulkCancel()
  const bulkRemoveMutation = useBulkRemove()
  
  // Local state
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [logsDialogOpen, setLogsDialogOpen] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  
  // Selection state for bulk actions
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  
  // Live streaming state (inline on page, not dialog)
  const [streamingJobId, setStreamingJobId] = useState<string | null>(null)
  const [streamingJobName, setStreamingJobName] = useState<string>('')
  const [streamingLogs, setStreamingLogs] = useState<string[]>([])
  const [streamingProgress, setStreamingProgress] = useState(0)
  const [streamingStatus, setStreamingStatus] = useState<'running' | 'completed' | 'failed' | null>(null)
  const streamingLogsEndRef = useRef<HTMLDivElement>(null)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('all')
  
  // Create Job Dialog state
  const [createJobDialogOpen, setCreateJobDialogOpen] = useState(false)
  
  // Create Schedule Dialog state
  const [createScheduleDialogOpen, setCreateScheduleDialogOpen] = useState(false)
  
  // Tab state for Jobs/Schedules view
  const [activeTab, setActiveTab] = useState<'jobs' | 'schedules'>('jobs')

  // Extract jobs from API response and transform to UI format
  const jobs = (jobsData?.jobs || []).map(job => ({
    ...job,
    originalStatus: job.status, // Keep original status to detect 'delayed' jobs
    status: normalizeStatus(job.status),
    type: job.type || job.name as JobType,
    name: job.data?.target || job.name || 'Unknown Job',
    target: job.data?.target || job.target || '*',
    triggeredBy: job.data?.userName || job.createdBy || 'system',
    progress: typeof job.progress === 'number' ? job.progress : 0,
    logs: job.data?.logs || job.logs || [],
    duration: job.finishedOn && job.processedOn 
      ? Math.floor((job.finishedOn - job.processedOn) / 1000) 
      : undefined,
  }))

  const stats = jobsData?.stats || { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 }

  // Date filter helper
  const getDateCutoff = (filter: 'today' | 'week' | 'month' | 'all'): Date | null => {
    const now = new Date()
    switch (filter) {
      case 'today': 
        return new Date(now.getFullYear(), now.getMonth(), now.getDate())
      case 'week': 
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case 'month': 
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      default: 
        return null
    }
  }

  // Filtered jobs - apply search, status, type, and date filters
  const filteredJobs = useMemo(() => {
    const cutoff = getDateCutoff(dateFilter)
    
    return jobs.filter(job => {
      // Search filter - match name, target, type, or triggeredBy
      const matchesSearch = !searchQuery || 
        job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (job.target && job.target.toLowerCase().includes(searchQuery.toLowerCase())) ||
        job.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (job.triggeredBy && job.triggeredBy.toLowerCase().includes(searchQuery.toLowerCase()))
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || normalizeStatus(job.status) === statusFilter
      
      // Type filter
      const matchesType = typeFilter === 'all' || job.type === typeFilter
      
      // Date filter
      const jobDate = job.startedAt ? new Date(job.startedAt) : (job.timestamp ? new Date(job.timestamp) : null)
      const matchesDate = !cutoff || (jobDate && jobDate >= cutoff)
      
      return matchesSearch && matchesStatus && matchesType && matchesDate
    })
  }, [jobs, searchQuery, statusFilter, typeFilter, dateFilter])

  // Categorize filtered jobs
  const runningJobs = filteredJobs.filter(j => normalizeStatus(j.status) === 'running')
  const queuedJobs = filteredJobs.filter(j => normalizeStatus(j.status) === 'queued')
  const completedJobs = filteredJobs.filter(j => normalizeStatus(j.status) === 'completed')
  const failedJobs = filteredJobs.filter(j => normalizeStatus(j.status) === 'failed')

  // Get unique job types for filter dropdown
  const availableJobTypes = useMemo(() => {
    const types = new Set(jobs.map(j => j.type))
    return Array.from(types).sort()
  }, [jobs])

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setTypeFilter('all')
    setDateFilter('all')
  }

  // Check if any filters are active
  const hasActiveFilters = searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || dateFilter !== 'all'

  // Get IDs of running jobs for streaming
  const runningJobIds = useMemo(() => 
    runningJobs.map(j => j.id),
    [runningJobs]
  )

  // Subscribe to real-time updates for running jobs
  const jobStreams = useMultipleJobStreams(runningJobIds)

  // Auto-expand first job in list (running > queued > recent)
  useEffect(() => {
    if (jobs.length > 0 && expandedJobs.size === 0) {
      // Priority: running job, then first job in list
      const runningJob = runningJobs[0]
      const firstJob = runningJob || jobs[0]
      if (firstJob) {
        setExpandedJobs(new Set([firstJob.id]))
      }
    }
  }, [jobs, runningJobs])

  // Auto-expand running jobs when they start
  useEffect(() => {
    if (runningJobs.length > 0) {
      const runningIds = runningJobs.map(j => j.id)
      setExpandedJobs(prev => {
        const newSet = new Set(prev)
        runningIds.forEach(id => newSet.add(id))
        return newSet
      })
    }
  }, [runningJobs])

  // Auto-refresh every 2 seconds when jobs are running or queued
  useEffect(() => {
    if (runningJobs.length > 0 || queuedJobs.length > 0) {
      const interval = setInterval(() => {
        refetch()
      }, 2000)
      return () => clearInterval(interval)
    }
  }, [runningJobs.length, queuedJobs.length, refetch])

  // Auto-scroll logs to bottom when new logs arrive (only scroll the container, not the page)
  useEffect(() => {
    if (logsEndRef.current) {
      const container = logsEndRef.current.parentElement
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [jobStreams])

  // Auto-scroll streaming logs (only scroll the container, not the page)
  useEffect(() => {
    if (streamingLogsEndRef.current) {
      const container = streamingLogsEndRef.current.parentElement
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [streamingLogs])

  // Start SSE stream for a job (inline on page)
  const startJobStream = useCallback((jobId: string, jobName: string) => {
    setStreamingJobId(jobId)
    setStreamingJobName(jobName)
    setStreamingLogs(['📡 Verbinde mit Log-Stream...'])
    setStreamingProgress(5)
    setStreamingStatus('running')

    const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'log') {
          setStreamingLogs(prev => [...prev.slice(-100), data.message])
        } else if (data.type === 'progress') {
          setStreamingProgress(Math.min(95, data.progress || 0))
          if (data.message) {
            setStreamingLogs(prev => [...prev.slice(-100), data.message])
          }
        } else if (data.type === 'completed') {
          setStreamingProgress(100)
          setStreamingStatus('completed')
          setStreamingLogs(prev => [...prev, '✅ Job erfolgreich abgeschlossen!'])
          eventSource.close()
          // Refresh job list
          refetch()
        } else if (data.type === 'failed') {
          setStreamingStatus('failed')
          setStreamingLogs(prev => [...prev, `❌ Fehler: ${data.error || 'Unknown error'}`])
          eventSource.close()
          // Refresh job list
          refetch()
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err)
      }
    }

    eventSource.onerror = () => {
      console.error('SSE connection error')
      setStreamingLogs(prev => [...prev, '⚠️ Stream unterbrochen, Job läuft im Hintergrund'])
      eventSource.close()
      refetch()
    }
  }, [refetch])

  // Clear streaming state
  const clearStreamingState = useCallback(() => {
    setStreamingJobId(null)
    setStreamingJobName('')
    setStreamingLogs([])
    setStreamingProgress(0)
    setStreamingStatus(null)
  }, [])

  const getStatusIntent = (status: string) => {
    const normalized = normalizeStatus(status)
    switch (normalized) {
      case 'running': return 'primary'
      case 'queued': return 'none'
      case 'completed': return 'success'
      case 'failed': return 'danger'
      case 'cancelled': return 'warning'
      default: return 'none'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'dbt-run': return 'build'
      case 'dbt-test': return 'lab-test'
      case 'validation':
      case 'validate': return 'tick-circle'
      case 'deploy': return 'cloud-upload'
      case 'schema-deploy': return 'database'
      case 'import': return 'import'
      case 'export': return 'export'
      default: return 'cog'
    }
  }

  const getJobTypeLabel = (type: string): string => {
    switch (type) {
      case 'dbt-run': return 'dbt Run'
      case 'dbt-test': return 'dbt Test'
      case 'validation':
      case 'validate': return 'Validierung'
      case 'deploy': return 'Data Deploy'
      case 'schema-deploy': return 'Schema Deploy'
      case 'import': return 'Import'
      case 'export': return 'Export'
      default: return type
    }
  }

  const toggleExpand = (jobId: string) => {
    const newExpanded = new Set(expandedJobs)
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId)
    } else {
      newExpanded.add(jobId)
    }
    setExpandedJobs(newExpanded)
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return '-'
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const handleCancelJob = async (job: typeof jobs[0]) => {
    try {
      await cancelJobMutation.mutateAsync(job.id)
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel job')
    }
  }

  const handleRetryJob = async (job: typeof jobs[0]) => {
    try {
      const result = await retryJobMutation.mutateAsync(job.id)
      // Start live streaming for the new job BEFORE refetching
      const newJobId = result?.newJob?.id || result?.jobId
      if (newJobId) {
        startJobStream(newJobId, job.name || 'Job')
      }
      // Refetch after a short delay to allow stream to connect
      setTimeout(() => refetch(), 500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to retry job')
    }
  }

  // Handler for promoting (starting) a paused/delayed job
  const handlePromoteJob = async (job: typeof jobs[0]) => {
    try {
      await promoteJobMutation.mutateAsync(job.id)
      // Start live streaming for the promoted job
      startJobStream(job.id, job.name || 'Job')
      // Refetch to update the job status
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start job')
    }
  }

  // Bulk action handlers
  const toggleJobSelection = (jobId: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) {
        next.delete(jobId)
      } else {
        next.add(jobId)
      }
      return next
    })
  }

  const selectAllJobs = () => {
    setSelectedJobs(new Set(filteredJobs.map(j => j.id)))
  }

  const clearSelection = () => {
    setSelectedJobs(new Set())
    setSelectionMode(false)
  }

  const handleBulkRetry = async () => {
    const failedJobIds = Array.from(selectedJobs).filter(id => {
      const job = jobs.find(j => j.id === id)
      return job && job.status === 'failed'
    })
    
    if (failedJobIds.length === 0) {
      alert('Keine fehlgeschlagenen Jobs ausgewählt')
      return
    }
    
    try {
      const result = await bulkRetryMutation.mutateAsync(failedJobIds)
      alert(`${result.successCount} von ${result.total} Jobs neu gestartet`)
      clearSelection()
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk retry failed')
    }
  }

  const handleBulkCancel = async () => {
    const cancelableJobIds = Array.from(selectedJobs).filter(id => {
      const job = jobs.find(j => j.id === id)
      return job && (job.status === 'running' || job.status === 'queued')
    })
    
    if (cancelableJobIds.length === 0) {
      alert('Keine aktiven oder wartenden Jobs ausgewählt')
      return
    }
    
    if (!confirm(`${cancelableJobIds.length} Jobs abbrechen?`)) return
    
    try {
      const result = await bulkCancelMutation.mutateAsync(cancelableJobIds)
      alert(`${result.successCount} von ${result.total} Jobs abgebrochen`)
      clearSelection()
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk cancel failed')
    }
  }

  const handleBulkRemove = async () => {
    if (!confirm(`${selectedJobs.size} Jobs endgültig entfernen?`)) return
    
    try {
      const result = await bulkRemoveMutation.mutateAsync(Array.from(selectedJobs))
      alert(`${result.successCount} von ${result.total} Jobs entfernt`)
      clearSelection()
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk remove failed')
    }
  }

  const JobCard = ({ job, streamData }: { job: typeof jobs[0]; streamData?: JobStreamState }) => {
    // Use stream data for running jobs, fallback to static data
    const isRunning = normalizeStatus(job.status) === 'running'
    const progress = streamData?.progress ?? job.progress
    const logs = streamData?.logs?.length ? streamData.logs : (job.logs || [])
    const streamStatus = streamData?.status
    const isSelected = selectedJobs.has(job.id)
    
    return (
    <Card style={{ marginBottom: 12, padding: 0, outline: isSelected ? '2px solid var(--intent-primary, #137cbd)' : undefined }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          cursor: 'pointer'
        }}
        onClick={() => selectionMode ? toggleJobSelection(job.id) : toggleExpand(job.id)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectionMode ? (
            <input 
              type="checkbox" 
              checked={isSelected}
              onChange={() => toggleJobSelection(job.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
          ) : (
            <Icon
              icon={expandedJobs.has(job.id) ? 'chevron-down' : 'chevron-right'}
              size={16}
            />
          )}
          {isRunning ? (
            <Spinner size={16} intent="primary" />
          ) : (
            <Icon icon={getTypeIcon(job.type)} size={16} />
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{job.name}</strong>
              <Tag minimal intent={job.originalStatus === 'delayed' ? 'warning' : getStatusIntent(job.status)}>
                {getStatusLabel(job.status, job.originalStatus)}
              </Tag>
              {isRunning && streamStatus === 'connected' && (
                <Tag minimal intent="success" icon="feed">LIVE</Tag>
              )}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {getJobTypeLabel(job.type)} • Target: {job.target || 'N/A'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isRunning && (
            <div style={{ width: 120 }}>
              <ProgressBar 
                value={progress / 100} 
                intent="primary"
                stripes
                animate
              />
              <div className="text-muted" style={{ fontSize: 10, textAlign: 'center' }}>
                {Math.round(progress)}%
              </div>
            </div>
          )}
          <div className="text-muted" style={{ fontSize: 11 }}>
            <Icon icon="user" size={12} /> {job.triggeredBy}
          </div>
          {job.startedAt && (
            <div className="text-muted" style={{ fontSize: 11 }}>
              <Icon icon="time" size={12} /> {formatDate(job.startedAt)}
            </div>
          )}
          {job.duration && (
            <div className="text-muted" style={{ fontSize: 11 }}>
              {formatDuration(job.duration)}
            </div>
          )}
        </div>
      </div>

      <Collapse isOpen={expandedJobs.has(job.id)}>
        <div style={{
          borderTop: '1px solid var(--border-color, #e1e8ed)',
          padding: 16,
          background: 'var(--card-bg-secondary, #f5f8fa)'
        }}>
          {/* Error Message */}
          {(job.error || job.failedReason || streamData?.error) && (
            <Callout intent="danger" icon="error" style={{ marginBottom: 12 }}>
              {job.error || job.failedReason || streamData?.error}
            </Callout>
          )}

          {/* Progress for running jobs */}
          {isRunning && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <ProgressBar 
                value={progress / 100} 
                intent="primary"
                stripes
                animate
              />
            </div>
          )}

          {/* Job Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 10 }}>TYPE</div>
              <div>{job.type}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 10 }}>TARGET</div>
              <div><code>{job.target}</code></div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 10 }}>TRIGGERED BY</div>
              <div>{job.triggeredBy}</div>
            </div>
          </div>

          {/* Logs Preview - Use streaming logs for running jobs */}
          {logs.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="text-muted" style={{ fontSize: 10, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                OUTPUT {isRunning && streamStatus === 'connected' && <Tag minimal intent="success" style={{ fontSize: 9 }}>LIVE</Tag>}
              </div>
              <div style={{ 
                background: '#1c2127', 
                color: '#a7b6c2', 
                padding: 8, 
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 11,
                maxHeight: isRunning ? 200 : 100,
                overflow: 'auto'
              }}>
                {(isRunning ? logs : logs.slice(-5)).map((log, i) => (
                  <div 
                    key={i}
                    style={{
                      color: log.includes('ERROR') || log.includes('✗') ? '#ff7373' : 
                             log.includes('✓') || log.includes('completed') || log.includes('passed') ? '#3dcc91' : 
                             log.includes('INFO') || log.includes('Running') ? '#48aff0' :
                             '#a7b6c2'
                    }}
                  >
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {logs.length > 0 && (
              <Button 
                small 
                icon="console"
                onClick={(e) => { 
                  e.stopPropagation()
                  setSelectedJob({...job, logs} as unknown as Job)
                  setLogsDialogOpen(true)
                }}
              >
                Vollständige Logs
              </Button>
            )}
            <Button
              small
              minimal
              icon="document-open"
              onClick={(e) => { 
                e.stopPropagation();
                router.push(`/jobs/${job.id}`);
              }}
            >
              Details
            </Button>
            {isRunning && (
              <Button 
                small 
                intent="danger"
                icon="stop"
                loading={cancelJobMutation.isPending}
                onClick={(e) => { e.stopPropagation(); handleCancelJob(job); }}
              >
                Cancel
              </Button>
            )}
            {/* Show "Starten" button for delayed (paused) jobs */}
            {job.originalStatus === 'delayed' && (
              <Button 
                small 
                intent="success"
                icon="play"
                loading={promoteJobMutation.isPending}
                onClick={(e) => { e.stopPropagation(); handlePromoteJob(job); }}
              >
                Starten
              </Button>
            )}
            {(normalizeStatus(job.status) === 'failed' || normalizeStatus(job.status) === 'cancelled') && (
              <Button 
                small 
                icon="refresh"
                loading={retryJobMutation.isPending}
                onClick={(e) => { e.stopPropagation(); handleRetryJob(job); }}
              >
                Wiederholen
              </Button>
            )}
            {normalizeStatus(job.status) === 'completed' && (
              <Button 
                small 
                icon="repeat"
                loading={retryJobMutation.isPending}
                onClick={(e) => { e.stopPropagation(); handleRetryJob(job); }}
              >
                Erneut ausführen
              </Button>
            )}
          </div>
        </div>
      </Collapse>
    </Card>
  )}

  return (
    <>
      <Header 
        title="Jobs" 
        breadcrumb={['Operations', 'Jobs']}
      />

      <div className="page-content">
        {/* Loading State */}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner size={40} />
          </div>
        )}

        {/* Error State */}
        {error && (
          <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>
            Failed to load jobs: {error.message}
            <Button small minimal icon="refresh" onClick={() => refetch()} style={{ marginLeft: 8 }}>
              Retry
            </Button>
          </Callout>
        )}

        {/* Stats */}
        {!isLoading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Aktiv</span>
            <span className="kpi-value" style={{ color: stats.active > 0 ? 'var(--intent-primary, #137cbd)' : undefined }}>
              {stats.active || 0}
            </span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Wartend</span>
            <span className="kpi-value">{(stats.waiting || 0) + (stats.delayed || 0)}</span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Abgeschlossen</span>
            <span className="kpi-value" style={{ color: stats.completed > 0 ? 'var(--intent-success, #0f9960)' : undefined }}>
              {stats.completed || 0}
            </span>
          </div>
          <div className="kpi-card" style={{ flex: 1 }}>
            <span className="kpi-label">Fehlgeschlagen</span>
            <span className="kpi-value" style={{ color: stats.failed > 0 ? 'var(--intent-danger, #db3737)' : undefined }}>
              {stats.failed || 0}
            </span>
          </div>
        </div>
        )}

        {/* Job Metrics Dashboard - collapsible */}
        <JobMetricsCard initialCollapsed={true} />

        {/* Live Streaming Callout - Deploy-Style (like on /deploy page) */}
        {streamingStatus && (
          <Callout 
            intent={streamingStatus === 'failed' ? 'danger' : streamingStatus === 'completed' ? 'success' : 'primary'}
            icon={streamingStatus === 'failed' ? 'error' : streamingStatus === 'completed' ? 'tick-circle' : 'cloud-upload'}
            title={streamingStatus === 'running' ? 'Deployment läuft...' : streamingStatus === 'completed' ? 'Deployment erfolgreich!' : 'Deployment fehlgeschlagen'}
            style={{ marginBottom: 16, position: 'relative' }}
          >
            {streamingStatus !== 'running' && (
              <Button 
                small 
                minimal 
                icon="cross" 
                onClick={clearStreamingState}
                style={{ position: 'absolute', top: 10, right: 10 }}
              />
            )}
            <ProgressBar
              value={streamingProgress / 100}
              intent={streamingStatus === 'failed' ? 'danger' : streamingStatus === 'completed' ? 'success' : 'primary'}
              animate={streamingStatus === 'running'}
              stripes={streamingStatus === 'running'}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray3)' }}>
              {streamingJobId && <span>Job ID: {streamingJobId}</span>}
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
              {streamingLogs.join('\n')}
            </pre>
          </Callout>
        )}

        {/* Worker Status Warning - only show if no worker activity for a while */}
        {queuedJobs.length > 0 && runningJobs.length === 0 && stats.completed === 0 && (
          <Callout intent="warning" icon="offline" style={{ marginBottom: 16 }}>
            <strong>{queuedJobs.length} Jobs warten auf Verarbeitung.</strong> Der Background-Worker scheint nicht aktiv zu sein. 
            Starten Sie den Worker mit: <code>npm exec tsx src/lib/queue/worker.ts</code>
          </Callout>
        )}

        <div className="section-header">
          <h2>Job Queue</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <WorkerStatus />
            <Button 
              icon="add" 
              intent="primary" 
              onClick={() => setCreateJobDialogOpen(true)}
            >
              Neuer Job
            </Button>
            <Button icon="refresh" minimal onClick={() => refetch()}>
              Aktualisieren
            </Button>
          </div>
        </div>

        {/* Tabs - positioned like on Deploy page */}
        <div style={{ marginBottom: 16 }}>
          <Tabs
            id="job-tabs"
            selectedTabId={activeTab}
            onChange={(tabId) => setActiveTab(tabId as 'jobs' | 'schedules')}
          >
            <Tab id="jobs" title="Jobs" />
            <Tab id="schedules" title="Zeitpläne" icon="time" />
          </Tabs>
        </div>

        {/* Schedules Tab Content */}
        {activeTab === 'schedules' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button 
                icon="add" 
                intent="primary" 
                onClick={() => setCreateScheduleDialogOpen(true)}
              >
                Neuer Zeitplan
              </Button>
            </div>
            <SchedulesList onCreateNew={() => setCreateScheduleDialogOpen(true)} />
          </div>
        )}

        {/* Jobs Tab Content */}
        {activeTab === 'jobs' && (
        <>

        {/* Filter Bar */}
        <Card style={{ marginBottom: 16, padding: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search */}
            <InputGroup 
              leftIcon="search" 
              placeholder="Jobs suchen..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: 220 }}
              rightElement={
                searchQuery ? (
                  <Button 
                    minimal 
                    small 
                    icon="cross" 
                    onClick={() => setSearchQuery('')}
                  />
                ) : undefined
              }
            />
            
            {/* Status Filter */}
            <HTMLSelect 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value)}
              iconName="caret-down"
            >
              <option value="all">Alle Status</option>
              <option value="running">Läuft</option>
              <option value="queued">Wartend</option>
              <option value="completed">Fertig</option>
              <option value="failed">Fehler</option>
            </HTMLSelect>
            
            {/* Type Filter */}
            <HTMLSelect 
              value={typeFilter} 
              onChange={e => setTypeFilter(e.target.value)}
              iconName="caret-down"
            >
              <option value="all">Alle Typen</option>
              {availableJobTypes.map(type => (
                <option key={type} value={type}>{getJobTypeLabel(type)}</option>
              ))}
            </HTMLSelect>
            
            {/* Date Filter */}
            <ButtonGroup>
              <Button 
                small
                active={dateFilter === 'today'} 
                onClick={() => setDateFilter('today')}
              >
                Heute
              </Button>
              <Button 
                small
                active={dateFilter === 'week'} 
                onClick={() => setDateFilter('week')}
              >
                7 Tage
              </Button>
              <Button 
                small
                active={dateFilter === 'month'} 
                onClick={() => setDateFilter('month')}
              >
                30 Tage
              </Button>
              <Button 
                small
                active={dateFilter === 'all'} 
                onClick={() => setDateFilter('all')}
              >
                Alle
              </Button>
            </ButtonGroup>
            
            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button 
                small 
                minimal 
                icon="cross" 
                intent="danger"
                onClick={clearFilters}
              >
                Filter zurücksetzen
              </Button>
            )}
          </div>
          
          {/* Filter Results Count */}
          {hasActiveFilters && (
            <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
              <Icon icon="filter" size={12} /> {filteredJobs.length} von {jobs.length} Jobs angezeigt
            </div>
          )}
        </Card>

        {/* Running Jobs */}
        {runningJobs.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>
              <Spinner size={14} intent="primary" /> Aktiv
            </h3>
            {runningJobs.map(job => (
              <JobCard key={job.id} job={job} streamData={jobStreams.get(job.id)} />
            ))}
          </div>
        )}

        {/* Queued Jobs */}
        {queuedJobs.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>
              <Icon icon="time" /> Warteschlange ({queuedJobs.length})
            </h3>
            {queuedJobs.map(job => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        {/* Recent Jobs */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              <Icon icon="history" /> Letzte Jobs
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {!selectionMode ? (
                <Button 
                  small 
                  minimal 
                  icon="select" 
                  onClick={() => setSelectionMode(true)}
                  disabled={filteredJobs.length === 0}
                >
                  Auswählen
                </Button>
              ) : (
                <>
                  <Button 
                    small 
                    minimal 
                    icon="tick-circle" 
                    onClick={selectAllJobs}
                  >
                    Alle
                  </Button>
                  <Button 
                    small 
                    minimal 
                    icon="cross" 
                    onClick={clearSelection}
                  >
                    Abbrechen
                  </Button>
                </>
              )}
            </div>
          </div>
          
          {/* Bulk Actions Bar */}
          {selectionMode && selectedJobs.size > 0 && (
            <Callout 
              intent="primary" 
              icon="tick-circle"
              style={{ marginBottom: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><strong>{selectedJobs.size}</strong> Job(s) ausgewählt</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button 
                    small 
                    icon="refresh" 
                    intent="success"
                    loading={bulkRetryMutation.isPending}
                    onClick={handleBulkRetry}
                  >
                    Retry ({Array.from(selectedJobs).filter(id => jobs.find(j => j.id === id)?.status === 'failed').length})
                  </Button>
                  <Button 
                    small 
                    icon="stop" 
                    intent="warning"
                    loading={bulkCancelMutation.isPending}
                    onClick={handleBulkCancel}
                  >
                    Cancel ({Array.from(selectedJobs).filter(id => {
                      const job = jobs.find(j => j.id === id)
                      return job && (job.status === 'running' || job.status === 'queued')
                    }).length})
                  </Button>
                  <Button 
                    small 
                    icon="trash" 
                    intent="danger"
                    loading={bulkRemoveMutation.isPending}
                    onClick={handleBulkRemove}
                  >
                    Entfernen
                  </Button>
                </div>
              </div>
            </Callout>
          )}
          
          {!isLoading && filteredJobs.length === 0 && !hasActiveFilters && (
            <NonIdealState
              icon="inbox"
              title="Keine Jobs"
              description="Jobs werden automatisch erstellt wenn Sie Schema-Deploy, Data-Deploy oder andere Operationen ausführen."
            />
          )}
          {!isLoading && filteredJobs.length === 0 && hasActiveFilters && (
            <NonIdealState
              icon="search"
              title="Keine Treffer"
              description="Keine Jobs entsprechen den aktuellen Filterkriterien."
              action={
                <Button icon="cross" onClick={clearFilters}>
                  Filter zurücksetzen
                </Button>
              }
            />
          )}
          {filteredJobs
            .filter(j => normalizeStatus(j.status) !== 'running' && normalizeStatus(j.status) !== 'queued')
            .slice(0, 10)
            .map(job => (
              <JobCard key={job.id} job={job} />
            ))}
        </div>

        {/* Load More Button */}
        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button 
              icon="more" 
              onClick={loadMore}
              loading={isLoading}
            >
              Weitere Jobs laden ({currentLimit} von {totalJobs})
            </Button>
          </div>
        )}

        {/* Show total loaded info */}
        {!hasMore && jobs.length > 0 && (
          <div className="text-muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 12 }}>
            <Icon icon="tick-circle" size={12} /> Alle {jobs.length} Jobs geladen
          </div>
        )}
        </>
        )}
      </div>

      {/* Full Logs Dialog */}
      <Dialog
        isOpen={logsDialogOpen}
        onClose={() => setLogsDialogOpen(false)}
        title={`Logs: ${selectedJob?.name}`}
        icon="console"
        style={{ width: 700 }}
      >
        <div className="bp5-dialog-body">
          {selectedJob && (
            <div style={{ 
              background: '#1c2127', 
              color: '#a7b6c2', 
              padding: 16, 
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: 12,
              maxHeight: 400,
              overflow: 'auto'
            }}>
              {selectedJob.logs?.map((log, i) => (
                <div key={i} style={{ 
                  marginBottom: 4,
                  color: log.includes('ERROR') ? '#ff7373' : 
                         log.includes('completed') || log.includes('passed') ? '#3dcc91' : 
                         '#a7b6c2'
                }}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setLogsDialogOpen(false)}>Schließen</Button>
          </div>
        </div>
      </Dialog>

      {/* Create Job Dialog */}
      <CreateJobDialog
        isOpen={createJobDialogOpen}
        onClose={() => setCreateJobDialogOpen(false)}
        onJobCreated={(jobId, jobName) => {
          // Start live streaming for the new job
          startJobStream(jobId, jobName)
          // Refresh job list
          refetch()
        }}
      />

      {/* Create Schedule Dialog */}
      <CreateScheduleDialog
        isOpen={createScheduleDialogOpen}
        onClose={() => setCreateScheduleDialogOpen(false)}
        onSuccess={() => {
          // Switch to schedules tab to show the new schedule
          setActiveTab('schedules')
        }}
      />
    </>
  )
}
