import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
export type DataRowStatus = 'draft' | 'pending' | 'approved' | 'rejected'

export interface DataRow {
  row_id: string
  entity_id: string
  status: DataRowStatus
  created_by: string
  created_at: string
  modified_by: string | null
  modified_at: string | null
  approved_by: string | null
  approved_at: string | null
  commit_id: string | null
  data: Record<string, unknown>
}

export interface DataQueryParams {
  entityId: string
  status?: DataRowStatus
  page?: number
  pageSize?: number
  search?: string
}

// API functions
async function fetchData(params: DataQueryParams): Promise<{
  data: DataRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.pageSize) searchParams.set('pageSize', params.pageSize.toString())
  if (params.search) searchParams.set('search', params.search)
  
  const url = `/api/data/${params.entityId}?${searchParams.toString()}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch data')
  }
  return response.json()
}

async function createDataRows(
  entityId: string,
  rows: Record<string, unknown>[]
): Promise<{ data: DataRow[]; created: number }> {
  const response = await fetch(`/api/data/${entityId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  if (!response.ok) {
    throw new Error('Failed to create data')
  }
  return response.json()
}

async function updateDataRowsStatus(
  entityId: string,
  rowIds: string[],
  status: DataRowStatus
): Promise<{ success: boolean; updated: number }> {
  const response = await fetch(`/api/data/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row_ids: rowIds, status }),
  })
  if (!response.ok) {
    throw new Error('Failed to update data')
  }
  return response.json()
}

async function deleteDataRows(
  entityId: string,
  rowIds: string[]
): Promise<{ success: boolean; deleted: number; deleted_ids: string[] }> {
  const response = await fetch(`/api/data/${entityId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row_ids: rowIds }),
  })
  if (!response.ok) {
    throw new Error('Failed to delete data')
  }
  return response.json()
}

// Hooks
export function useData(params: DataQueryParams) {
  return useQuery({
    queryKey: ['data', params],
    queryFn: () => fetchData(params),
    enabled: !!params.entityId,
    staleTime: 10 * 1000, // 10 seconds
  })
}

export function useCreateData() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, rows }: { entityId: string; rows: Record<string, unknown>[] }) =>
      createDataRows(entityId, rows),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['data', { entityId }] })
      queryClient.invalidateQueries({ queryKey: ['entities', entityId] }) // Update record count
    },
  })
}

export function useUpdateDataStatus() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, rowIds, status }: {
      entityId: string
      rowIds: string[]
      status: DataRowStatus
    }) => updateDataRowsStatus(entityId, rowIds, status),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['data', { entityId }] })
    },
  })
}

export function useDeleteData() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, rowIds }: { entityId: string; rowIds: string[] }) =>
      deleteDataRows(entityId, rowIds),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['data', { entityId }] })
      queryClient.invalidateQueries({ queryKey: ['entities', entityId] })
    },
  })
}

export function useSubmitForApproval() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, rowIds }: { entityId: string; rowIds: string[] }) =>
      updateDataRowsStatus(entityId, rowIds, 'pending'),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['data', { entityId }] })
      queryClient.invalidateQueries({ queryKey: ['commits'] })
    },
  })
}
