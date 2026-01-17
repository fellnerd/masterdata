import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'

// Types matching the API response
export type JobStatus = 'queued' | 'waiting' | 'active' | 'running' | 'completed' | 'failed' | 'cancelled' | 'delayed' | 'unknown'
export type JobType = 'dbt-run' | 'dbt-test' | 'validate' | 'deploy' | 'schema-deploy' | 'import' | 'export' | 'sync' | 'cleanup'

export interface Job {
  id: string
  name: string
  type: JobType
  target: string
  status: JobStatus
  progress: number
  data: {
    type: JobType
    target: string
    userId: string
    userName: string
    createdAt: string
    params?: Record<string, unknown>
    logs?: string[]
  }
  logs?: string[]
  startedAt: string | null
  completedAt: string | null
  error: string | null
  createdBy: string
  timestamp?: number
  processedOn?: number
  finishedOn?: number
  failedReason?: string
}

export interface JobStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  total: number
}

export interface JobsResponse {
  stats: JobStats
  jobs: Job[]
  hasMore?: boolean
  total?: number
}

// API functions
async function fetchJobs(status?: JobStatus, limit?: number): Promise<JobsResponse> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (limit) params.set('limit', limit.toString())
  
  const url = `/api/jobs${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch jobs')
  }
  return response.json()
}

async function fetchJob(jobId: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch job')
  }
  return response.json()
}

async function startJob(data: {
  type: JobType
  target?: string
  params?: Record<string, unknown>
}): Promise<{ success: boolean; job: { id: string; name: string } }> {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Failed to start job')
  }
  return response.json()
}

async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Failed to cancel job')
  }
}

async function retryJob(jobId: string): Promise<{ success: boolean; newJob?: { id: string; name: string }; jobId?: string }> {
  // Use rerun action to create a new job with the same data
  const response = await fetch(`/api/jobs/${jobId}?action=rerun`, {
    method: 'POST',
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Failed to retry job')
  }
  const result = await response.json()
  // Map jobId to newJob.id for backwards compatibility
  return {
    ...result,
    newJob: result.jobId ? { id: result.jobId, name: '' } : result.newJob
  }
}

// Hooks
export function useJobs(status?: JobStatus) {
  return useQuery({
    queryKey: ['jobs', { status }],
    queryFn: () => fetchJobs(status),
    staleTime: 5 * 1000, // 5 seconds - jobs need frequent updates
    refetchInterval: 10 * 1000, // Auto-refresh every 10 seconds
  })
}

/**
 * useJobsWithPagination - Hook mit Pagination-Support
 * Erlaubt das Laden von mehr Jobs mit "Mehr laden" Button
 */
export function useJobsWithPagination(initialLimit = 20) {
  const [limit, setLimit] = useState(initialLimit)
  
  const query = useQuery({
    queryKey: ['jobs', { limit }],
    queryFn: () => fetchJobs(undefined, limit),
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
  })
  
  const loadMore = useCallback(() => {
    setLimit(prev => prev + 20)
  }, [])
  
  const resetLimit = useCallback(() => {
    setLimit(initialLimit)
  }, [initialLimit])
  
  return { 
    ...query, 
    loadMore, 
    resetLimit,
    currentLimit: limit,
    hasMore: query.data?.hasMore ?? false,
    totalJobs: query.data?.total ?? query.data?.stats?.total ?? 0
  }
}

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: !!jobId,
    staleTime: 2 * 1000, // 2 seconds for active job
    refetchInterval: (query) => {
      // Refetch every 3 seconds if job is running or queued
      const job = query.state.data as Job | undefined
      if (job && (job.status === 'active' || job.status === 'waiting' || job.status === 'running' || job.status === 'queued')) {
        return 3000
      }
      return false
    },
  })
}

export function useStartJob() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: startJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useCancelJob() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useRetryJob() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: retryJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

// Bulk operations
interface BulkResult {
  action: string;
  total: number;
  successCount: number;
  failedCount: number;
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

async function bulkAction(action: 'retry' | 'cancel' | 'remove', jobIds: string[]): Promise<BulkResult> {
  const response = await fetch('/api/jobs/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, jobIds })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Bulk operation failed');
  }
  return response.json();
}

export function useBulkRetry() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobIds: string[]) => bulkAction('retry', jobIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useBulkCancel() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobIds: string[]) => bulkAction('cancel', jobIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useBulkRemove() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobIds: string[]) => bulkAction('remove', jobIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
