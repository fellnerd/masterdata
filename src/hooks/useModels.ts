import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
export interface Model {
  model_id: string
  model_name: string
  model_description: string | null
  created_by: string
  created_at: string
  is_active: boolean
  entity_count?: number
  record_count?: number
}

// API functions
async function fetchModels(): Promise<{ data: Model[]; total: number }> {
  const response = await fetch('/api/models')
  if (!response.ok) {
    throw new Error('Failed to fetch models')
  }
  return response.json()
}

async function fetchModel(modelId: string): Promise<Model> {
  const response = await fetch(`/api/models/${modelId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch model')
  }
  return response.json()
}

async function createModel(data: { name: string; description?: string }): Promise<Model> {
  const response = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to create model')
  }
  return response.json()
}

async function updateModel(modelId: string, data: Partial<Model>): Promise<Model> {
  const response = await fetch(`/api/models/${modelId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to update model')
  }
  return response.json()
}

async function deleteModel(modelId: string): Promise<void> {
  const response = await fetch(`/api/models/${modelId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to delete model')
  }
}

// Hooks
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: fetchModels,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useModel(modelId: string | null) {
  return useQuery({
    queryKey: ['models', modelId],
    queryFn: () => fetchModel(modelId!),
    enabled: !!modelId,
    staleTime: 30 * 1000,
  })
}

export function useCreateModel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: createModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useUpdateModel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ modelId, data }: { modelId: string; data: Partial<Model> }) =>
      updateModel(modelId, data),
    onSuccess: (_, { modelId }) => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['models', modelId] })
    },
  })
}

export function useDeleteModel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: deleteModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
}
