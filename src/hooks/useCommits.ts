import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
export type CommitStatus = 'pending' | 'ready' | 'deployed' | 'rejected'

export interface Commit {
  commit_id: string
  commit_message: string
  status: CommitStatus
  created_by: string
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  deployed_at: string | null
  dbt_job_id: string | null
  changes_summary: {
    inserts: number
    updates: number
    deletes: number
    entities: string[]
  }
}

export interface CommitDetail extends Commit {
  changes: Array<{
    row_id: string
    entity_name: string
    change_type: 'INSERT' | 'UPDATE' | 'DELETE'
    new_values: Record<string, unknown> | null
    old_values: Record<string, unknown> | null
  }>
  history: Array<{
    timestamp: string
    action: string
    user: string
    comment: string | null
  }>
}

// API functions
async function fetchCommits(status?: CommitStatus): Promise<{
  data: Commit[]
  total: number
  statusCounts: Record<CommitStatus, number>
}> {
  const url = status ? `/api/commits?status=${status}` : '/api/commits'
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch commits')
  }
  return response.json()
}

async function fetchCommit(commitId: string): Promise<CommitDetail> {
  const response = await fetch(`/api/commits/${commitId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch commit')
  }
  return response.json()
}

async function createCommit(data: {
  message: string
  row_ids?: string[]
  entity_ids?: string[]
}): Promise<Commit> {
  const response = await fetch('/api/commits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to create commit')
  }
  return response.json()
}

async function updateCommitStatus(
  commitId: string,
  action: 'approve' | 'reject' | 'deploy',
  comment?: string
): Promise<Commit> {
  const response = await fetch(`/api/commits/${commitId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, comment }),
  })
  if (!response.ok) {
    throw new Error('Failed to update commit')
  }
  return response.json()
}

async function cancelCommit(commitId: string): Promise<void> {
  const response = await fetch(`/api/commits/${commitId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to cancel commit')
  }
}

// Hooks
export function useCommits(status?: CommitStatus) {
  return useQuery({
    queryKey: ['commits', { status }],
    queryFn: () => fetchCommits(status),
    staleTime: 10 * 1000, // 10 seconds - commits change frequently
  })
}

export function useCommit(commitId: string | null) {
  return useQuery({
    queryKey: ['commits', commitId],
    queryFn: () => fetchCommit(commitId!),
    enabled: !!commitId,
    staleTime: 10 * 1000,
  })
}

export function useCreateCommit() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: createCommit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commits'] })
      queryClient.invalidateQueries({ queryKey: ['data'] }) // Refresh data too
    },
  })
}

export function useApproveCommit() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (commitId: string) => updateCommitStatus(commitId, 'approve'),
    onSuccess: (_, commitId) => {
      queryClient.invalidateQueries({ queryKey: ['commits'] })
      queryClient.invalidateQueries({ queryKey: ['commits', commitId] })
    },
  })
}

export function useRejectCommit() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ commitId, comment }: { commitId: string; comment?: string }) =>
      updateCommitStatus(commitId, 'reject', comment),
    onSuccess: (_, { commitId }) => {
      queryClient.invalidateQueries({ queryKey: ['commits'] })
      queryClient.invalidateQueries({ queryKey: ['commits', commitId] })
    },
  })
}

export function useDeployCommit() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (commitId: string) => updateCommitStatus(commitId, 'deploy'),
    onSuccess: (_, commitId) => {
      queryClient.invalidateQueries({ queryKey: ['commits'] })
      queryClient.invalidateQueries({ queryKey: ['commits', commitId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] }) // New job created
    },
  })
}

export function useCancelCommit() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: cancelCommit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commits'] })
      queryClient.invalidateQueries({ queryKey: ['data'] })
    },
  })
}
