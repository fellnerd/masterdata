'use client'

import { useState } from 'react'
import {
  Button,
  HTMLTable,
  Tag,
  Card,
  Icon,
  ProgressBar,
  Callout,
  Collapse,
  Tabs,
  Tab,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  IconName
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

interface ValidationRule {
  id: string
  name: string
  description: string
  entity: string
  type: 'required' | 'unique' | 'format' | 'range' | 'reference' | 'custom'
  severity: 'error' | 'warning' | 'info'
  field?: string
  enabled: boolean
}

interface ValidationResult {
  id: string
  ruleId: string
  ruleName: string
  entity: string
  severity: 'error' | 'warning' | 'info'
  affectedRecords: number
  totalRecords: number
  examples: ValidationExample[]
  lastRun: string
}

interface ValidationExample {
  recordId: string
  field: string
  value: string
  message: string
}

const mockRules: ValidationRule[] = [
  { id: '1', name: 'Customer Name Required', description: 'Customer name cannot be empty', entity: 'Customer', type: 'required', severity: 'error', field: 'name', enabled: true },
  { id: '2', name: 'Customer ID Unique', description: 'Customer ID must be unique', entity: 'Customer', type: 'unique', severity: 'error', field: 'customer_id', enabled: true },
  { id: '3', name: 'Email Format', description: 'Email must be valid format', entity: 'Contact', type: 'format', severity: 'error', field: 'email', enabled: true },
  { id: '4', name: 'Revenue Positive', description: 'Revenue must be greater than zero', entity: 'Customer', type: 'range', severity: 'warning', field: 'revenue', enabled: true },
  { id: '5', name: 'Country Reference', description: 'Country must exist in Countries master', entity: 'Customer', type: 'reference', severity: 'error', field: 'country', enabled: true },
  { id: '6', name: 'Phone Format', description: 'Phone number should match pattern', entity: 'Contact', type: 'format', severity: 'warning', field: 'phone', enabled: true },
  { id: '7', name: 'Industry Standard', description: 'Industry must be from standard list', entity: 'Customer', type: 'reference', severity: 'info', field: 'industry', enabled: false },
]

const mockResults: ValidationResult[] = [
  {
    id: '1',
    ruleId: '3',
    ruleName: 'Email Format',
    entity: 'Contact',
    severity: 'error',
    affectedRecords: 12,
    totalRecords: 3421,
    lastRun: '2024-01-08T11:30:00Z',
    examples: [
      { recordId: 'CONT-234', field: 'email', value: 'invalid-email', message: 'Invalid email format' },
      { recordId: 'CONT-567', field: 'email', value: 'missing@', message: 'Invalid email format' },
      { recordId: 'CONT-890', field: 'email', value: '', message: 'Email is empty' }
    ]
  },
  {
    id: '2',
    ruleId: '4',
    ruleName: 'Revenue Positive',
    entity: 'Customer',
    severity: 'warning',
    affectedRecords: 3,
    totalRecords: 1250,
    lastRun: '2024-01-08T11:30:00Z',
    examples: [
      { recordId: 'CUST-045', field: 'revenue', value: '-50000', message: 'Revenue is negative' },
      { recordId: 'CUST-078', field: 'revenue', value: '0', message: 'Revenue is zero' }
    ]
  },
  {
    id: '3',
    ruleId: '5',
    ruleName: 'Country Reference',
    entity: 'Customer',
    severity: 'error',
    affectedRecords: 2,
    totalRecords: 1250,
    lastRun: '2024-01-08T11:30:00Z',
    examples: [
      { recordId: 'CUST-112', field: 'country', value: 'XX', message: 'Country code "XX" not found' },
      { recordId: 'CUST-089', field: 'country', value: 'ZZ', message: 'Country code "ZZ" not found' }
    ]
  },
  {
    id: '4',
    ruleId: '6',
    ruleName: 'Phone Format',
    entity: 'Contact',
    severity: 'warning',
    affectedRecords: 45,
    totalRecords: 3421,
    lastRun: '2024-01-08T11:30:00Z',
    examples: [
      { recordId: 'CONT-001', field: 'phone', value: '12345', message: 'Phone number too short' },
      { recordId: 'CONT-023', field: 'phone', value: 'abc-def', message: 'Invalid characters in phone' }
    ]
  }
]

export default function ValidationPage() {
  const [rules, setRules] = useState<ValidationRule[]>(mockRules)
  const [results] = useState<ValidationResult[]>(mockResults)
  const [selectedTab, setSelectedTab] = useState<string>('results')
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set())
  const [isRunning, setIsRunning] = useState(false)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)

  const errorCount = results.filter(r => r.severity === 'error').reduce((sum, r) => sum + r.affectedRecords, 0)
  const warningCount = results.filter(r => r.severity === 'warning').reduce((sum, r) => sum + r.affectedRecords, 0)
  const totalRecords = 4671 // Sum of unique records
  const dqScore = Math.round(((totalRecords - errorCount - warningCount) / totalRecords) * 100)

  const getSeverityIntent = (severity: ValidationResult['severity']) => {
    switch (severity) {
      case 'error': return 'danger'
      case 'warning': return 'warning'
      case 'info': return 'primary'
    }
  }

  const getRuleTypeIcon = (type: ValidationRule['type']): IconName => {
    switch (type) {
      case 'required': return 'asterisk'
      case 'unique': return 'key'
      case 'format': return 'regex'
      case 'range': return 'numerical'
      case 'reference': return 'link'
      case 'custom': return 'code'
    }
  }

  const toggleExpand = (resultId: string) => {
    const newExpanded = new Set(expandedResults)
    if (newExpanded.has(resultId)) {
      newExpanded.delete(resultId)
    } else {
      newExpanded.add(resultId)
    }
    setExpandedResults(newExpanded)
  }

  const handleRunValidation = () => {
    setIsRunning(true)
    // Simulate validation run
    setTimeout(() => {
      setIsRunning(false)
    }, 2000)
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

  const ResultCard = ({ result }: { result: ValidationResult }) => (
    <Card
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
        onClick={() => toggleExpand(result.id)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon
            icon={expandedResults.has(result.id) ? 'chevron-down' : 'chevron-right'}
            size={16}
          />
          <Icon
            icon={result.severity === 'error' ? 'error' : result.severity === 'warning' ? 'warning-sign' : 'info-sign'}
            intent={getSeverityIntent(result.severity)}
            size={16}
          />
          <div>
            <div style={{ fontWeight: 500 }}>{result.ruleName}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {result.entity} • {result.affectedRecords} of {result.totalRecords} records
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Tag minimal intent={getSeverityIntent(result.severity)}>
            {result.affectedRecords} {result.severity === 'error' ? 'errors' : result.severity === 'warning' ? 'warnings' : 'issues'}
          </Tag>
          <span className="text-muted" style={{ fontSize: 11 }}>
            {formatDate(result.lastRun)}
          </span>
        </div>
      </div>

      <Collapse isOpen={expandedResults.has(result.id)}>
        <div style={{
          borderTop: '1px solid var(--border-color, #e1e8ed)',
          padding: 16,
          background: 'var(--card-bg-secondary, #f5f8fa)'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: 12 }}>Affected Records (Sample)</h4>
          <HTMLTable striped style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr>
                <th>Record ID</th>
                <th>Field</th>
                <th>Value</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {result.examples.map((ex, i) => (
                <tr key={i}>
                  <td><code>{ex.recordId}</code></td>
                  <td>{ex.field}</td>
                  <td>
                    <code style={{ color: 'var(--intent-danger, #db3737)' }}>
                      {ex.value || '(empty)'}
                    </code>
                  </td>
                  <td className="text-muted">{ex.message}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button small icon="th" onClick={(e) => e.stopPropagation()}>
              View All Records
            </Button>
            <Button small icon="export" onClick={(e) => e.stopPropagation()}>
              Export
            </Button>
          </div>
        </div>
      </Collapse>
    </Card>
  )

  return (
    <>
      <Header title="Validation" breadcrumb={['Operations', 'Validation']} />

      <div className="page-content">
        {/* DQ Score Dashboard */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <Card style={{ flex: 2, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Data Quality Score</h3>
              <Button
                icon="refresh"
                intent="primary"
                small
                loading={isRunning}
                onClick={handleRunValidation}
              >
                Run Validation
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <div style={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                border: `8px solid ${dqScore >= 95 ? '#0f9960' : dqScore >= 80 ? '#d9822b' : '#db3737'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                fontWeight: 700
              }}>
                {dqScore}%
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>Overall Quality</span>
                    <span>{totalRecords - errorCount - warningCount} / {totalRecords} records valid</span>
                  </div>
                  <ProgressBar
                    value={dqScore / 100}
                    intent={dqScore >= 95 ? 'success' : dqScore >= 80 ? 'warning' : 'danger'}
                    stripes={false}
                  />
                </div>
                <div className="text-muted" style={{ fontSize: 11 }}>
                  Last validation: {formatDate(results[0]?.lastRun || new Date().toISOString())}
                </div>
              </div>
            </div>
          </Card>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="kpi-card" style={{ flex: 1 }}>
              <span className="kpi-label">Errors</span>
              <span className="kpi-value" style={{ color: 'var(--intent-danger, #db3737)' }}>{errorCount}</span>
            </div>
            <div className="kpi-card" style={{ flex: 1 }}>
              <span className="kpi-label">Warnings</span>
              <span className="kpi-value" style={{ color: 'var(--intent-warning, #d9822b)' }}>{warningCount}</span>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="kpi-card" style={{ flex: 1 }}>
              <span className="kpi-label">Active Rules</span>
              <span className="kpi-value">{rules.filter(r => r.enabled).length}</span>
            </div>
            <div className="kpi-card" style={{ flex: 1 }}>
              <span className="kpi-label">Entities Covered</span>
              <span className="kpi-value">{new Set(rules.map(r => r.entity)).size}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          id="validation-tabs"
          selectedTabId={selectedTab}
          onChange={(newTab) => setSelectedTab(newTab as string)}
        >
          <Tab
            id="results"
            title={
              <span>
                Issues
                {results.length > 0 && (
                  <Tag minimal round intent="danger" style={{ marginLeft: 8 }}>
                    {results.length}
                  </Tag>
                )}
              </span>
            }
          />
          <Tab id="rules" title="Validation Rules" />
          <Tab id="history" title="History" />
        </Tabs>

        {/* Results Tab */}
        {selectedTab === 'results' && (
          <div style={{ marginTop: 16 }}>
            {results.length === 0 ? (
              <Callout intent="success" icon="tick-circle">
                All validation rules passed! No issues found.
              </Callout>
            ) : (
              <>
                {/* Errors */}
                {results.filter(r => r.severity === 'error').length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                      <Icon icon="error" intent="danger" /> Errors ({results.filter(r => r.severity === 'error').length})
                    </h3>
                    {results.filter(r => r.severity === 'error').map(result => (
                      <ResultCard key={result.id} result={result} />
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {results.filter(r => r.severity === 'warning').length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                      <Icon icon="warning-sign" intent="warning" /> Warnings ({results.filter(r => r.severity === 'warning').length})
                    </h3>
                    {results.filter(r => r.severity === 'warning').map(result => (
                      <ResultCard key={result.id} result={result} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Rules Tab */}
        {selectedTab === 'rules' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button small icon="add" intent="primary" onClick={() => setRuleDialogOpen(true)}>
                Add Rule
              </Button>
            </div>
            <HTMLTable striped interactive style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Active</th>
                  <th>Rule Name</th>
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Field</th>
                  <th>Severity</th>
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id}>
                    <td>
                      <Icon
                        icon={rule.enabled ? 'tick' : 'cross'}
                        intent={rule.enabled ? 'success' : 'none'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setRules(rules.map(r =>
                          r.id === rule.id ? { ...r, enabled: !r.enabled } : r
                        ))}
                      />
                    </td>
                    <td>
                      <div>{rule.name}</div>
                      <div className="text-muted" style={{ fontSize: 10 }}>{rule.description}</div>
                    </td>
                    <td>
                      <Tag minimal>{rule.entity}</Tag>
                    </td>
                    <td>
                      <Tag minimal icon={getRuleTypeIcon(rule.type)}>
                        {rule.type}
                      </Tag>
                    </td>
                    <td><code>{rule.field || '-'}</code></td>
                    <td>
                      <Tag minimal intent={getSeverityIntent(rule.severity)}>
                        {rule.severity}
                      </Tag>
                    </td>
                    <td>
                      <Button small minimal icon="edit" />
                      <Button small minimal icon="trash" intent="danger" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        )}

        {/* History Tab */}
        {selectedTab === 'history' && (
          <div style={{ marginTop: 16 }}>
            <HTMLTable striped style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Run Time</th>
                  <th>Duration</th>
                  <th>Rules Executed</th>
                  <th>Errors</th>
                  <th>Warnings</th>
                  <th>DQ Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatDate('2024-01-08T11:30:00Z')}</td>
                  <td>2.3s</td>
                  <td>6</td>
                  <td><Tag minimal intent="danger">14</Tag></td>
                  <td><Tag minimal intent="warning">48</Tag></td>
                  <td>98%</td>
                  <td><Button small minimal icon="eye-open">View</Button></td>
                </tr>
                <tr>
                  <td>{formatDate('2024-01-08T06:00:00Z')}</td>
                  <td>2.1s</td>
                  <td>6</td>
                  <td><Tag minimal intent="danger">15</Tag></td>
                  <td><Tag minimal intent="warning">52</Tag></td>
                  <td>98%</td>
                  <td><Button small minimal icon="eye-open">View</Button></td>
                </tr>
                <tr>
                  <td>{formatDate('2024-01-07T18:00:00Z')}</td>
                  <td>2.4s</td>
                  <td>6</td>
                  <td><Tag minimal intent="danger">18</Tag></td>
                  <td><Tag minimal intent="warning">61</Tag></td>
                  <td>97%</td>
                  <td><Button small minimal icon="eye-open">View</Button></td>
                </tr>
              </tbody>
            </HTMLTable>
          </div>
        )}
      </div>

      {/* Add Rule Dialog */}
      <Dialog
        isOpen={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        title="Add Validation Rule"
        icon="add"
      >
        <div className="bp5-dialog-body">
          <FormGroup label="Rule Name" labelFor="rule-name">
            <InputGroup id="rule-name" placeholder="e.g., Email Format" />
          </FormGroup>
          <FormGroup label="Description" labelFor="rule-desc">
            <InputGroup id="rule-desc" placeholder="Describe what this rule validates" />
          </FormGroup>
          <div style={{ display: 'flex', gap: 12 }}>
            <FormGroup label="Entity" labelFor="rule-entity" style={{ flex: 1 }}>
              <HTMLSelect id="rule-entity" fill options={['Customer', 'Contact', 'Product', 'Supplier']} />
            </FormGroup>
            <FormGroup label="Field" labelFor="rule-field" style={{ flex: 1 }}>
              <InputGroup id="rule-field" placeholder="Field name" />
            </FormGroup>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <FormGroup label="Type" labelFor="rule-type" style={{ flex: 1 }}>
              <HTMLSelect id="rule-type" fill options={['required', 'unique', 'format', 'range', 'reference', 'custom']} />
            </FormGroup>
            <FormGroup label="Severity" labelFor="rule-severity" style={{ flex: 1 }}>
              <HTMLSelect id="rule-severity" fill options={['error', 'warning', 'info']} />
            </FormGroup>
          </div>
        </div>
        <div className="bp5-dialog-footer">
          <div className="bp5-dialog-footer-actions">
            <Button onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button intent="primary">Create Rule</Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
