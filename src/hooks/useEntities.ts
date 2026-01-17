import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
export interface Entity {
  entity_id: string
  model_id: string
  model_name?: string
  entity_name: string
  entity_description: string | null
  business_key_attr: string | null
  created_by: string
  created_at: string
  is_active: boolean
  attribute_count?: number
  record_count?: number
}

export interface Attribute {
  attr_id: string
  entity_id: string
  attr_name: string
  attr_label: string | null
  data_type: string
  is_required: boolean
  is_unique: boolean
  default_value: string | null
  sort_order: number
  validation_regex: string | null
}

// API functions
async function fetchEntities(modelId?: string): Promise<{ data: Entity[]; total: number }> {
  const url = modelId ? `/api/entities?model_id=${modelId}` : '/api/entities'
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch entities')
  }
  return response.json()
}

async function fetchEntity(entityId: string): Promise<Entity & { attributes: Attribute[] }> {
  const response = await fetch(`/api/entities/${entityId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch entity')
  }
  return response.json()
}

async function createEntity(data: {
  model_id: string
  name: string
  description?: string
  business_key?: string
}): Promise<Entity> {
  const response = await fetch('/api/entities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to create entity')
  }
  return response.json()
}

async function updateEntity(entityId: string, data: Partial<Entity>): Promise<Entity> {
  const response = await fetch(`/api/entities/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to update entity')
  }
  return response.json()
}

async function deleteEntity(entityId: string): Promise<void> {
  const response = await fetch(`/api/entities/${entityId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to delete entity')
  }
}

// Attribute API functions
async function fetchAttributes(entityId: string): Promise<{ data: Attribute[]; total: number; data_types: string[] }> {
  const response = await fetch(`/api/entities/${entityId}/attributes`)
  if (!response.ok) {
    throw new Error('Failed to fetch attributes')
  }
  return response.json()
}

async function createAttribute(entityId: string, data: Partial<Attribute>): Promise<Attribute> {
  const response = await fetch(`/api/entities/${entityId}/attributes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error('Failed to create attribute')
  }
  return response.json()
}

// Hooks
export function useEntities(modelId?: string) {
  return useQuery({
    queryKey: ['entities', { modelId }],
    queryFn: () => fetchEntities(modelId),
    staleTime: 30 * 1000,
  })
}

export function useEntity(entityId: string | null) {
  return useQuery({
    queryKey: ['entities', entityId],
    queryFn: () => fetchEntity(entityId!),
    enabled: !!entityId,
    staleTime: 30 * 1000,
  })
}

export function useCreateEntity() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: createEntity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] })
    },
  })
}

export function useUpdateEntity() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, data }: { entityId: string; data: Partial<Entity> }) =>
      updateEntity(entityId, data),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['entities'] })
      queryClient.invalidateQueries({ queryKey: ['entities', entityId] })
    },
  })
}

export function useDeleteEntity() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: deleteEntity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] })
    },
  })
}

// Attribute hooks
export function useAttributes(entityId: string | null) {
  return useQuery({
    queryKey: ['attributes', entityId],
    queryFn: () => fetchAttributes(entityId!),
    enabled: !!entityId,
    staleTime: 30 * 1000,
  })
}

export function useCreateAttribute() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, data }: { entityId: string; data: Partial<Attribute> }) =>
      createAttribute(entityId, data),
    onSuccess: (_, { entityId }) => {
      queryClient.invalidateQueries({ queryKey: ['attributes', entityId] })
      queryClient.invalidateQueries({ queryKey: ['entities', entityId] })
    },
  })
}
