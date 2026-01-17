import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// Types
type SeverityLevel = 'error' | 'warning' | 'info'
type IssueStatus = 'open' | 'resolved' | 'ignored'

interface ValidationRule {
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

interface ValidationIssue {
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

interface DQMetrics {
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

// Mock validation rules
const validationRules: ValidationRule[] = [
  {
    rule_id: 'rule-001',
    rule_name: 'Unique Customer ID',
    rule_type: 'uniqueness',
    entity_name: 'Customers',
    attribute_name: 'customer_id',
    severity: 'error',
    is_active: true,
    description: 'Customer ID must be unique across all records',
    error_template: 'Duplicate customer_id: {value}',
  },
  {
    rule_id: 'rule-002',
    rule_name: 'Required Customer Name',
    rule_type: 'required',
    entity_name: 'Customers',
    attribute_name: 'customer_name',
    severity: 'error',
    is_active: true,
    description: 'Customer name is required',
    error_template: 'Customer name is missing for record {row_id}',
  },
  {
    rule_id: 'rule-003',
    rule_name: 'Email Format',
    rule_type: 'format',
    entity_name: 'Customers',
    attribute_name: 'email',
    severity: 'warning',
    is_active: true,
    description: 'Email must be in valid format',
    error_template: 'Invalid email format: {value}',
  },
  {
    rule_id: 'rule-004',
    rule_name: 'Phone Format',
    rule_type: 'format',
    entity_name: 'Customers',
    attribute_name: 'phone',
    severity: 'info',
    is_active: true,
    description: 'Phone should be in international format',
    error_template: 'Phone {value} may not be in international format',
  },
  {
    rule_id: 'rule-005',
    rule_name: 'Country Reference',
    rule_type: 'reference',
    entity_name: 'Customers',
    attribute_name: 'country',
    severity: 'error',
    is_active: true,
    description: 'Country must exist in Countries entity',
    error_template: 'Unknown country: {value}',
  },
  {
    rule_id: 'rule-006',
    rule_name: 'Product Price Range',
    rule_type: 'range',
    entity_name: 'Products',
    attribute_name: 'price',
    severity: 'warning',
    is_active: true,
    description: 'Price should be between 0 and 999999',
    error_template: 'Price {value} is outside valid range',
  },
  {
    rule_id: 'rule-007',
    rule_name: 'Contact Email Unique',
    rule_type: 'uniqueness',
    entity_name: 'Contacts',
    attribute_name: 'email',
    severity: 'error',
    is_active: true,
    description: 'Contact email must be unique',
    error_template: 'Duplicate contact email: {value}',
  },
]

// Mock validation issues
const validationIssues: ValidationIssue[] = [
  {
    issue_id: 'issue-001',
    rule_id: 'rule-003',
    rule_name: 'Email Format',
    entity_name: 'Customers',
    attribute_name: 'email',
    row_id: 'row-045',
    severity: 'warning',
    status: 'open',
    message: 'Invalid email format: john.doe@company',
    detected_at: '2023-03-20T09:15:00Z',
    resolved_at: null,
    resolved_by: null,
  },
  {
    issue_id: 'issue-002',
    rule_id: 'rule-004',
    rule_name: 'Phone Format',
    entity_name: 'Customers',
    attribute_name: 'phone',
    row_id: 'row-102',
    severity: 'info',
    status: 'open',
    message: 'Phone 555-1234 may not be in international format',
    detected_at: '2023-03-20T09:15:00Z',
    resolved_at: null,
    resolved_by: null,
  },
  {
    issue_id: 'issue-003',
    rule_id: 'rule-001',
    rule_name: 'Unique Customer ID',
    entity_name: 'Customers',
    attribute_name: 'customer_id',
    row_id: 'row-156',
    severity: 'error',
    status: 'resolved',
    message: 'Duplicate customer_id: 1001',
    detected_at: '2023-03-19T14:30:00Z',
    resolved_at: '2023-03-19T15:00:00Z',
    resolved_by: 'admin',
  },
]

// GET /api/validation - Get validation overview and metrics
export async function GET(request: NextRequest) {
  logger.info('GET /api/validation')
  
  try {
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') // 'rules', 'issues', or default (overview)
    const severity = searchParams.get('severity') as SeverityLevel | null
    const status = searchParams.get('status') as IssueStatus | null
    // const entityId = searchParams.get('entity_id')  // TODO: filter by entity when DB is connected
    
    if (view === 'rules') {
      // Return validation rules
      let rules = validationRules
      if (severity) {
        rules = rules.filter(r => r.severity === severity)
      }
      return NextResponse.json({
        data: rules,
        total: rules.length,
      })
    }
    
    if (view === 'issues') {
      // Return validation issues
      let issues = validationIssues
      if (severity) {
        issues = issues.filter(i => i.severity === severity)
      }
      if (status) {
        issues = issues.filter(i => i.status === status)
      }
      return NextResponse.json({
        data: issues,
        total: issues.length,
      })
    }
    
    // Default: return overview/metrics
    const openIssues = validationIssues.filter(i => i.status === 'open')
    const metrics: DQMetrics = {
      overall_score: 99,
      total_records: 4521,
      valid_records: 4519,
      issues_by_severity: {
        error: openIssues.filter(i => i.severity === 'error').length,
        warning: openIssues.filter(i => i.severity === 'warning').length,
        info: openIssues.filter(i => i.severity === 'info').length,
      },
      trend: {
        direction: 'up',
        change: 0.5,
      },
    }
    
    return NextResponse.json({
      metrics,
      rules_count: validationRules.length,
      active_rules: validationRules.filter(r => r.is_active).length,
      open_issues: openIssues.length,
      recent_issues: openIssues.slice(0, 5),
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch validation data')
    return NextResponse.json(
      { error: 'Failed to fetch validation data' },
      { status: 500 }
    )
  }
}

// POST /api/validation - Run validation
export async function POST(request: NextRequest) {
  logger.info('POST /api/validation (run)')
  
  try {
    const body = await request.json()
    const { entity_id, full_scan = false } = body
    
    // TODO: Actually run validation against data
    // This would:
    // 1. Get all active rules for entity (or all entities if full_scan)
    // 2. Execute each rule against data
    // 3. Create new issues for violations
    // 4. Mark resolved issues that are now passing
    
    return NextResponse.json({
      success: true,
      run_id: `val-run-${Date.now()}`,
      entity_id: entity_id || 'all',
      full_scan,
      rules_executed: validationRules.filter(r => r.is_active).length,
      new_issues: 0,
      resolved_issues: 1,
      message: 'Validation completed successfully',
    }, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to run validation')
    return NextResponse.json(
      { error: 'Failed to run validation' },
      { status: 500 }
    )
  }
}
