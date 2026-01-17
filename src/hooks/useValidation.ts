import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
export type SeverityLevel = 'error' | 'warning' | 'info'
export type IssueStatus = 'open' | 'resolved' | 'ignored'

export interface ValidationRule {
  rule_id: string
  rule_name: string
  rule_type: 'uniqueness' | 'required' | 'format' | 'reference' | 'range' | 'custom'
  entity_name: string
  attribute_name: string | null
  severity: SeverityLevel
  is_active: boolean
  description: string
  error_template: string
}

export interface ValidationIssue {
  issue_id: string
  rule_id: string
  rule_name: string
  entity_name: string
  attribute_name: string | null
  row_id: string | null
  severity: SeverityLevel
  status: IssueStatus
  message: string
  detected_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface DQMetrics {
  overall_score: number
  total_records: number
  valid_records: number
  issues_by_severity: {
    error: number
    warning: number
    info: number
  }
  trend: {
    direction: 'up' | 'down' | 'stable'
    change: number
  }
}

export interface ValidationOverview {
  metrics: DQMetrics
  rules_count: number
  active_rules: number
  open_issues: number
  recent_issues: ValidationIssue[]
}

// API functions
async function fetchValidationOverview(): Promise<ValidationOverview> {
  const response = await fetch('/api/validation')
  if (!response.ok) {
    throw new Error('Failed to fetch validation overview')
  }
  return response.json()
}

async function fetchValidationRules(severity?: SeverityLevel): Promise<{
  data: ValidationRule[]
  total: number
}> {
  const params = new URLSearchParams({ view: 'rules' })
  if (severity) params.set('severity', severity)
  
  const response = await fetch(`/api/validation?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to fetch validation rules')
  }
  return response.json()
}

async function fetchValidationIssues(
  severity?: SeverityLevel,
  status?: IssueStatus
): Promise<{ data: ValidationIssue[]; total: number }> {
  const params = new URLSearchParams({ view: 'issues' })
  if (severity) params.set('severity', severity)
  if (status) params.set('status', status)
  
  const response = await fetch(`/api/validation?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to fetch validation issues')
  }
  return response.json()
}

async function runValidation(entityId?: string, fullScan = false): Promise<{
  success: boolean
  run_id: string
  rules_executed: number
  new_issues: number
  resolved_issues: number
}> {
  const response = await fetch('/api/validation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id: entityId, full_scan: fullScan }),
  })
  if (!response.ok) {
    throw new Error('Failed to run validation')
  }
  return response.json()
}

// Hooks
export function useValidationOverview() {
  return useQuery({
    queryKey: ['validation', 'overview'],
    queryFn: fetchValidationOverview,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useValidationRules(severity?: SeverityLevel) {
  return useQuery({
    queryKey: ['validation', 'rules', { severity }],
    queryFn: () => fetchValidationRules(severity),
    staleTime: 60 * 1000, // 1 minute - rules don't change often
  })
}

export function useValidationIssues(severity?: SeverityLevel, status?: IssueStatus) {
  return useQuery({
    queryKey: ['validation', 'issues', { severity, status }],
    queryFn: () => fetchValidationIssues(severity, status),
    staleTime: 30 * 1000,
  })
}

export function useRunValidation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ entityId, fullScan }: { entityId?: string; fullScan?: boolean }) =>
      runValidation(entityId, fullScan),
    onSuccess: () => {
      // Invalidate all validation queries after a run
      queryClient.invalidateQueries({ queryKey: ['validation'] })
    },
  })
}
