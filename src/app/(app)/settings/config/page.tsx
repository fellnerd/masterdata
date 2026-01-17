'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Button,
  Card,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Switch,
  Callout,
  Divider,
  Tag,
  Tabs,
  Tab,
  Icon,
  Spinner,
  Intent,
  Collapse,
  FileInput,
  RadioGroup,
  Radio
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

type ProfileInputMode = 'manual' | 'upload'

interface ImportSource {
  id: number
  name: string
  git_url: string | null
  git_branch: string
  dbt_project_path: string
  dbt_target: string | null
  local_path: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  last_connected_at: string | null
  error_message: string | null
  project_name: string | null
  models_json: string | null
  profile_name: string | null
  db_server: string | null
  db_port: number | null
  db_database: string | null
  db_schema: string | null
  db_auth_type: string | null
  db_user: string | null
  db_password: string | null
  db_encrypt: boolean | null
  db_trust_cert: boolean | null
}

interface ObjectsResponse {
  objects: Array<{
    name: string
    schema: string
    type: string
    materialized: string
  }>
  count: number
  grouped: {
    hubs: Array<unknown>
    satellites: Array<unknown>
    links: Array<unknown>
    staging: Array<unknown>
    marts: Array<unknown>
    pits: Array<unknown>
  }
}

export default function ConfigPage() {
  const [selectedTab, setSelectedTab] = useState('general')
  
  // General settings
  const [tenantName, setTenantName] = useState('Werkportal')
  const tenantId = 'werkportal'  // Read-only tenant identifier
  
  // dbt settings
  const [dbtTarget, setDbtTarget] = useState('werkportal')
  const [dbtProjectPath, setDbtProjectPath] = useState('/home/user/projects/datavault-dbt')
  const [dbtAutoRun, setDbtAutoRun] = useState(true)
  
  // Commit settings
  const [requireApproval, setRequireApproval] = useState(true)
  const [minApprovers, setMinApprovers] = useState(1)
  const [autoDeployApproved, setAutoDeployApproved] = useState(false)
  
  // Validation settings
  const [enableDQChecks, setEnableDQChecks] = useState(true)
  const [dqThreshold, setDqThreshold] = useState(95)
  const [blockOnDQFail, setBlockOnDQFail] = useState(true)

  // Import Source State
  const [importConfig, setImportConfig] = useState<ImportSource | null>(null)
  const [importObjects, setImportObjects] = useState<ObjectsResponse | null>(null)
  const [loadingImport, setLoadingImport] = useState(false)
  const [savingImport, setSavingImport] = useState(false)
  const [connectingImport, setConnectingImport] = useState(false)
  const [showDbSettings, setShowDbSettings] = useState(false)
  
  // Import Source Form State
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [importDbtProjectPath, setImportDbtProjectPath] = useState('/')
  const [importDbtTarget, setImportDbtTarget] = useState('')
  const [profileName, setProfileName] = useState('')
  const [dbServer, setDbServer] = useState('')
  const [dbPort, setDbPort] = useState(1433)
  const [dbDatabase, setDbDatabase] = useState('')
  const [dbSchema, setDbSchema] = useState('dbo')
  const [dbAuthType, setDbAuthType] = useState('sql')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [dbEncrypt, setDbEncrypt] = useState(true)
  const [dbTrustCert, setDbTrustCert] = useState(false)
  
  // Profile Input Mode
  const [profileInputMode, setProfileInputMode] = useState<ProfileInputMode>('manual')
  const [uploadedProfileContent, setUploadedProfileContent] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch Import Source Config
  const fetchImportConfig = useCallback(async () => {
    setLoadingImport(true)
    try {
      const res = await fetch('/api/settings/import-source')
      if (res.ok) {
        const data = await res.json()
        setImportConfig(data)
        setGitUrl(data.git_url || '')
        setGitBranch(data.git_branch || 'main')
        setImportDbtProjectPath(data.dbt_project_path || '/')
        setImportDbtTarget(data.dbt_target || '')
        setProfileName(data.profile_name || '')
        setDbServer(data.db_server || '')
        setDbPort(data.db_port || 1433)
        setDbDatabase(data.db_database || '')
        setDbSchema(data.db_schema || 'dbo')
        setDbAuthType(data.db_auth_type || 'sql')
        setDbUser(data.db_user || '')
        setDbPassword(data.db_password || '')
        setDbEncrypt(data.db_encrypt !== false)
        setDbTrustCert(data.db_trust_cert === true)
        if (data.db_server) setShowDbSettings(true)
      }
    } catch (error) {
      console.error('Failed to fetch import config:', error)
    } finally {
      setLoadingImport(false)
    }
  }, [])

  const fetchImportObjects = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/import-source/objects')
      if (res.ok) {
        const data = await res.json()
        setImportObjects(data)
      }
    } catch (error) {
      console.error('Failed to fetch import objects:', error)
    }
  }, [])

  // Load import config when connections tab is selected
  useEffect(() => {
    if (selectedTab === 'connections' && !importConfig) {
      fetchImportConfig()
    }
  }, [selectedTab, importConfig, fetchImportConfig])

  useEffect(() => {
    if (importConfig?.status === 'connected') {
      fetchImportObjects()
    }
  }, [importConfig?.status, fetchImportObjects])

  const handleSaveImportConfig = async () => {
    setSavingImport(true)
    try {
      const res = await fetch('/api/settings/import-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          git_url: gitUrl || null,
          git_branch: gitBranch || 'main',
          dbt_project_path: importDbtProjectPath || '/',
          dbt_target: importDbtTarget || null,
          profile_name: profileName || null,
          db_server: dbServer || null,
          db_port: dbPort || 1433,
          db_database: dbDatabase || null,
          db_schema: dbSchema || 'dbo',
          db_auth_type: dbAuthType || 'sql',
          db_user: dbUser || null,
          db_password: dbPassword || null,
          db_encrypt: dbEncrypt,
          db_trust_cert: dbTrustCert
        })
      })
      if (res.ok) {
        const data = await res.json()
        setImportConfig(data)
      }
    } catch (error) {
      console.error('Failed to save import config:', error)
    } finally {
      setSavingImport(false)
    }
  }

  const handleConnectImport = async () => {
    await handleSaveImportConfig()
    setConnectingImport(true)
    try {
      const res = await fetch('/api/settings/import-source/connect', { method: 'POST' })
      if (res.ok) {
        await fetchImportConfig()
        await fetchImportObjects()
      } else {
        await fetchImportConfig()
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      await fetchImportConfig()
    } finally {
      setConnectingImport(false)
    }
  }

  const handleDisconnectImport = async () => {
    try {
      const res = await fetch('/api/settings/import-source/disconnect', { method: 'POST' })
      if (res.ok) {
        setImportObjects(null)
        await fetchImportConfig()
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
    }
  }

  // Handle profile file upload
  const handleProfileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    try {
      const content = await file.text()
      setUploadedProfileContent(content)
      
      // Try to parse YAML to extract values
      // Simple regex-based extraction for common fields
      const serverMatch = content.match(/server:\s*['"]?([^\s'"]+)['"]?/i)
      const portMatch = content.match(/port:\s*(\d+)/i)
      const databaseMatch = content.match(/database:\s*['"]?([^\s'"]+)['"]?/i)
      const schemaMatch = content.match(/schema:\s*['"]?([^\s'"]+)['"]?/i)
      const userMatch = content.match(/user:\s*['"]?([^\s'"]+)['"]?/i)
      const passwordMatch = content.match(/password:\s*['"]?([^\s'"]+)['"]?/i)
      const authMatch = content.match(/authentication:\s*['"]?([^\s'"]+)['"]?/i)
      
      // Extract profile name from first key
      const profileNameMatch = content.match(/^(\w+):/m)
      
      if (profileNameMatch) setProfileName(profileNameMatch[1])
      if (serverMatch) setDbServer(serverMatch[1])
      if (portMatch) setDbPort(parseInt(portMatch[1]))
      if (databaseMatch) setDbDatabase(databaseMatch[1])
      if (schemaMatch) setDbSchema(schemaMatch[1])
      if (userMatch) setDbUser(userMatch[1])
      if (passwordMatch) setDbPassword(passwordMatch[1])
      if (authMatch) setDbAuthType(authMatch[1])
      
      // Auto-expand DB settings
      setShowDbSettings(true)
    } catch (error) {
      console.error('Failed to parse profile:', error)
    }
  }

  return (
    <>
      <Header title="Configuration" breadcrumb={['Settings', 'Configuration']} />

      <div className="page-content">
        <Tabs
          id="config-tabs"
          selectedTabId={selectedTab}
          onChange={(newTab) => setSelectedTab(newTab as string)}
          large
        >
          <Tab id="general" title="General" />
          <Tab id="dbt" title="dbt Settings" />
          <Tab id="workflow" title="Workflow" />
          <Tab id="connections" title="Connections" />
        </Tabs>

        <div style={{ marginTop: 24 }}>
          {/* General Settings */}
          {selectedTab === 'general' && (
            <Card>
              <h3 style={{ marginTop: 0 }}>Tenant Settings</h3>
              
              <FormGroup label="Tenant Name" labelInfo="(required)">
                <InputGroup
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="My Company"
                />
              </FormGroup>

              <FormGroup label="Tenant ID" labelInfo="(read-only)">
                <InputGroup
                  value={tenantId}
                  disabled
                  leftIcon="tag"
                />
              </FormGroup>

              <Divider style={{ margin: '24px 0' }} />

              <h3>Display Settings</h3>

              <FormGroup label="Default Language">
                <HTMLSelect defaultValue="de">
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </HTMLSelect>
              </FormGroup>

              <FormGroup label="Date Format">
                <HTMLSelect defaultValue="dd.MM.yyyy">
                  <option value="dd.MM.yyyy">DD.MM.YYYY</option>
                  <option value="yyyy-MM-dd">YYYY-MM-DD</option>
                  <option value="MM/dd/yyyy">MM/DD/YYYY</option>
                </HTMLSelect>
              </FormGroup>

              <div style={{ marginTop: 24 }}>
                <Button intent="primary">Save Changes</Button>
              </div>
            </Card>
          )}

          {/* dbt Settings */}
          {selectedTab === 'dbt' && (
            <Card>
              <h3 style={{ marginTop: 0 }}>dbt Configuration</h3>

              <Callout intent="primary" icon="info-sign" style={{ marginBottom: 16 }}>
                These settings control how dbt integrates with the Master Data Services.
              </Callout>

              <FormGroup label="dbt Target" helperText="Target profile from profiles.yml">
                <HTMLSelect
                  value={dbtTarget}
                  onChange={(e) => setDbtTarget(e.target.value)}
                >
                  <option value="dev">dev (Shared Development)</option>
                  <option value="werkportal">werkportal (Production)</option>
                  <option value="ewb">ewb (Future)</option>
                </HTMLSelect>
              </FormGroup>

              <FormGroup label="Project Path" helperText="Path to dbt project on server">
                <InputGroup
                  value={dbtProjectPath}
                  onChange={(e) => setDbtProjectPath(e.target.value)}
                  leftIcon="folder-open"
                />
              </FormGroup>

              <Divider style={{ margin: '24px 0' }} />

              <h3>Automation</h3>

              <Switch
                label="Auto-run dbt on deploy"
                checked={dbtAutoRun}
                onChange={(e) => setDbtAutoRun(e.target.checked)}
              />
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 16 }}>
                Automatically execute dbt run when changes are deployed
              </p>

              <FormGroup label="dbt Commands">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button small icon="play" intent="primary">dbt run</Button>
                  <Button small icon="lab-test">dbt test</Button>
                  <Button small icon="code">dbt compile</Button>
                  <Button small icon="console">dbt debug</Button>
                </div>
              </FormGroup>

              <div style={{ marginTop: 24 }}>
                <Button intent="primary">Save Changes</Button>
              </div>
            </Card>
          )}

          {/* Workflow Settings */}
          {selectedTab === 'workflow' && (
            <Card>
              <h3 style={{ marginTop: 0 }}>Approval Workflow</h3>

              <Switch
                label="Require approval for commits"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
              />

              {requireApproval && (
                <FormGroup 
                  label="Minimum Approvers" 
                  style={{ marginTop: 16 }}
                  helperText="Number of approvals required before deploy"
                >
                  <HTMLSelect
                    value={minApprovers}
                    onChange={(e) => setMinApprovers(Number(e.target.value))}
                  >
                    <option value={1}>1 Approver</option>
                    <option value={2}>2 Approvers</option>
                    <option value={3}>3 Approvers</option>
                  </HTMLSelect>
                </FormGroup>
              )}

              <Switch
                label="Auto-deploy after approval"
                checked={autoDeployApproved}
                onChange={(e) => setAutoDeployApproved(e.target.checked)}
                style={{ marginTop: 16 }}
              />
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 16 }}>
                Automatically deploy changes when approval threshold is met
              </p>

              <Divider style={{ margin: '24px 0' }} />

              <h3>Data Quality</h3>

              <Switch
                label="Enable DQ validation before commit"
                checked={enableDQChecks}
                onChange={(e) => setEnableDQChecks(e.target.checked)}
              />

              {enableDQChecks && (
                <>
                  <FormGroup 
                    label="DQ Score Threshold (%)" 
                    style={{ marginTop: 16 }}
                    helperText="Minimum quality score required"
                  >
                    <InputGroup
                      type="number"
                      value={dqThreshold.toString()}
                      onChange={(e) => setDqThreshold(Number(e.target.value))}
                      min={0}
                      max={100}
                      style={{ width: 100 }}
                    />
                  </FormGroup>

                  <Switch
                    label="Block commits on DQ failure"
                    checked={blockOnDQFail}
                    onChange={(e) => setBlockOnDQFail(e.target.checked)}
                    style={{ marginTop: 16 }}
                  />
                </>
              )}

              <div style={{ marginTop: 24 }}>
                <Button intent="primary">Save Changes</Button>
              </div>
            </Card>
          )}

          {/* Connections */}
          {selectedTab === 'connections' && (
            <>
              {loadingImport ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                  <Spinner />
                </div>
              ) : (
                <>
                  {/* Connection Status Card */}
                  <Card style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Icon 
                          icon={importConfig?.status === 'connected' ? 'tick-circle' : importConfig?.status === 'error' ? 'error' : 'offline'} 
                          size={24}
                          intent={importConfig?.status === 'connected' ? Intent.SUCCESS : importConfig?.status === 'error' ? Intent.DANGER : Intent.NONE}
                        />
                        <div>
                          <h3 style={{ margin: 0 }}>Data Vault Import Source</h3>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <Tag 
                              intent={importConfig?.status === 'connected' ? Intent.SUCCESS : importConfig?.status === 'error' ? Intent.DANGER : Intent.NONE} 
                              minimal
                            >
                              {importConfig?.status || 'disconnected'}
                            </Tag>
                            {importConfig?.project_name && (
                              <Tag minimal intent={Intent.PRIMARY}>{importConfig.project_name}</Tag>
                            )}
                            {importConfig?.last_connected_at && (
                              <span className="text-muted" style={{ fontSize: 12 }}>
                                Last connected: {new Date(importConfig.last_connected_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {importConfig?.status === 'connected' ? (
                          <Button intent={Intent.DANGER} outlined onClick={handleDisconnectImport}>
                            Disconnect
                          </Button>
                        ) : (
                          <Button 
                            intent={Intent.SUCCESS}
                            loading={connectingImport}
                            disabled={!gitUrl || !dbServer || !dbDatabase}
                            onClick={handleConnectImport}
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>

                  {/* Error Message */}
                  {importConfig?.status === 'error' && importConfig.error_message && (
                    <Callout intent={Intent.DANGER} style={{ marginBottom: 16 }}>
                      <strong>Connection Error:</strong> {importConfig.error_message}
                    </Callout>
                  )}

                  {/* Git Repository Settings */}
                  <Card style={{ marginBottom: 16 }}>
                    <h4 style={{ marginTop: 0 }}>
                      <Icon icon="git-repo" style={{ marginRight: 8 }} />
                      Git Repository Settings
                    </h4>
                    
                    <FormGroup 
                      label="Git URL or Local Path" 
                      labelInfo="(required)"
                      helperText="Git URL (https://github.com/org/repo.git) or local path (/path/to/project)"
                    >
                      <InputGroup
                        placeholder="https://github.com/org/repo.git"
                        value={gitUrl}
                        onChange={(e) => setGitUrl(e.target.value)}
                        disabled={importConfig?.status === 'connected'}
                        leftIcon="git-repo"
                      />
                    </FormGroup>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                      <FormGroup label="Branch" helperText="Git branch to clone">
                        <InputGroup
                          placeholder="main"
                          value={gitBranch}
                          onChange={(e) => setGitBranch(e.target.value)}
                          disabled={importConfig?.status === 'connected'}
                          leftIcon="git-branch"
                        />
                      </FormGroup>
                      
                      <FormGroup label="dbt Project Path" helperText="Path to dbt_project.yml">
                        <InputGroup
                          placeholder="/"
                          value={importDbtProjectPath}
                          onChange={(e) => setImportDbtProjectPath(e.target.value)}
                          disabled={importConfig?.status === 'connected'}
                          leftIcon="folder-open"
                        />
                      </FormGroup>

                      <FormGroup label="dbt Target" helperText="Profile target">
                        <InputGroup
                          placeholder="dev"
                          value={importDbtTarget}
                          onChange={(e) => setImportDbtTarget(e.target.value)}
                          disabled={importConfig?.status === 'connected'}
                        />
                      </FormGroup>
                    </div>
                  </Card>

                  {/* Database Connection Settings */}
                  <Card style={{ marginBottom: 16 }}>
                    <div 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        cursor: importConfig?.status === 'connected' ? 'default' : 'pointer',
                        marginBottom: showDbSettings ? 16 : 0
                      }}
                      onClick={() => importConfig?.status !== 'connected' && setShowDbSettings(!showDbSettings)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon="database" />
                        <h4 style={{ margin: 0 }}>Database Connection Settings</h4>
                        {dbServer && <Tag minimal intent={Intent.SUCCESS}>Configured</Tag>}
                      </div>
                      {importConfig?.status !== 'connected' && (
                        <Icon icon={showDbSettings ? 'chevron-up' : 'chevron-down'} />
                      )}
                    </div>
                    
                    <Collapse isOpen={showDbSettings || importConfig?.status === 'connected'}>
                      <Callout intent={Intent.PRIMARY} style={{ marginBottom: 16 }}>
                        Diese Einstellungen werden benötigt um eine <code>profiles.yml</code> für dbt zu generieren.
                      </Callout>
                      
                      {/* Input Mode Selection */}
                      {importConfig?.status !== 'connected' && (
                        <div style={{ marginBottom: 16 }}>
                          <RadioGroup
                            label="Eingabemethode"
                            onChange={(e) => setProfileInputMode((e.target as HTMLInputElement).value as ProfileInputMode)}
                            selectedValue={profileInputMode}
                            inline
                          >
                            <Radio label="Manuelle Eingabe" value="manual" />
                            <Radio label="profiles.yml hochladen" value="upload" />
                          </RadioGroup>
                        </div>
                      )}
                      
                      {/* File Upload */}
                      {profileInputMode === 'upload' && importConfig?.status !== 'connected' && (
                        <Card style={{ marginBottom: 16, backgroundColor: 'rgba(19, 124, 189, 0.1)' }}>
                          <FormGroup 
                            label="profiles.yml hochladen" 
                            helperText="Lade eine bestehende profiles.yml hoch. Die Werte werden automatisch extrahiert."
                          >
                            <input
                              type="file"
                              ref={fileInputRef}
                              accept=".yml,.yaml"
                              onChange={handleProfileUpload}
                              style={{ display: 'none' }}
                            />
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <Button 
                                icon="upload" 
                                onClick={() => fileInputRef.current?.click()}
                              >
                                Datei auswählen
                              </Button>
                              {uploadedProfileContent && (
                                <Tag intent={Intent.SUCCESS} icon="tick">
                                  Datei geladen - Werte extrahiert
                                </Tag>
                              )}
                            </div>
                          </FormGroup>
                          {uploadedProfileContent && (
                            <div style={{ marginTop: 8 }}>
                              <details>
                                <summary style={{ cursor: 'pointer', color: '#5c7080' }}>
                                  Hochgeladene Datei anzeigen
                                </summary>
                                <pre style={{ 
                                  fontSize: 11, 
                                  backgroundColor: '#1a1a2e', 
                                  color: '#a5d6ff',
                                  padding: 12, 
                                  borderRadius: 4,
                                  maxHeight: 200,
                                  overflow: 'auto',
                                  marginTop: 8
                                }}>
                                  {uploadedProfileContent}
                                </pre>
                              </details>
                            </div>
                          )}
                        </Card>
                      )}
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <FormGroup label="Profile Name" helperText="Muss mit dbt_project.yml übereinstimmen">
                          <InputGroup
                            placeholder="datavault"
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            disabled={importConfig?.status === 'connected'}
                          />
                        </FormGroup>
                        
                        <FormGroup label="Authentication Type">
                          <HTMLSelect
                            value={dbAuthType}
                            onChange={(e) => setDbAuthType(e.target.value)}
                            disabled={importConfig?.status === 'connected'}
                            fill
                          >
                            <option value="sql">SQL Authentication</option>
                            <option value="cli">Azure CLI</option>
                            <option value="msi">Managed Identity</option>
                          </HTMLSelect>
                        </FormGroup>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 16 }}>
                        <FormGroup label="Server" labelInfo="(required)">
                          <InputGroup
                            placeholder="myserver.database.windows.net"
                            value={dbServer}
                            onChange={(e) => setDbServer(e.target.value)}
                            disabled={importConfig?.status === 'connected'}
                            leftIcon="cloud"
                          />
                        </FormGroup>
                        
                        <FormGroup label="Port">
                          <InputGroup
                            type="number"
                            placeholder="1433"
                            value={String(dbPort)}
                            onChange={(e) => setDbPort(parseInt(e.target.value) || 1433)}
                            disabled={importConfig?.status === 'connected'}
                          />
                        </FormGroup>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <FormGroup label="Database" labelInfo="(required)">
                          <InputGroup
                            placeholder="Vault"
                            value={dbDatabase}
                            onChange={(e) => setDbDatabase(e.target.value)}
                            disabled={importConfig?.status === 'connected'}
                            leftIcon="database"
                          />
                        </FormGroup>
                        
                        <FormGroup label="Schema">
                          <InputGroup
                            placeholder="dbo"
                            value={dbSchema}
                            onChange={(e) => setDbSchema(e.target.value)}
                            disabled={importConfig?.status === 'connected'}
                          />
                        </FormGroup>
                      </div>
                      
                      {dbAuthType === 'sql' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <FormGroup label="Username" labelInfo="(required for SQL Auth)">
                            <InputGroup
                              placeholder="sqladmin"
                              value={dbUser}
                              onChange={(e) => setDbUser(e.target.value)}
                              disabled={importConfig?.status === 'connected'}
                              leftIcon="user"
                            />
                          </FormGroup>
                          
                          <FormGroup label="Password" labelInfo="(required for SQL Auth)">
                            <InputGroup
                              type="password"
                              placeholder="••••••••"
                              value={dbPassword}
                              onChange={(e) => setDbPassword(e.target.value)}
                              disabled={importConfig?.status === 'connected'}
                              leftIcon="lock"
                            />
                          </FormGroup>
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                        <Switch
                          checked={dbEncrypt}
                          onChange={(e) => setDbEncrypt((e.target as HTMLInputElement).checked)}
                          disabled={importConfig?.status === 'connected'}
                          label="Encrypt Connection"
                        />
                        <Switch
                          checked={dbTrustCert}
                          onChange={(e) => setDbTrustCert((e.target as HTMLInputElement).checked)}
                          disabled={importConfig?.status === 'connected'}
                          label="Trust Server Certificate"
                        />
                      </div>
                    </Collapse>
                  </Card>

                  {/* Save Button */}
                  {importConfig?.status !== 'connected' && (
                    <div style={{ marginBottom: 16 }}>
                      <Button 
                        intent={Intent.PRIMARY}
                        loading={savingImport}
                        onClick={handleSaveImportConfig}
                      >
                        Save Configuration
                      </Button>
                    </div>
                  )}

                  {/* Available Objects */}
                  {importConfig?.status === 'connected' && importObjects && (
                    <Card>
                      <h4 style={{ marginTop: 0 }}>
                        Available Data Vault Objects 
                        <Tag minimal style={{ marginLeft: 8 }}>{importObjects.count}</Tag>
                      </h4>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                        <div>
                          <h5 style={{ marginBottom: 8 }}>
                            <Icon icon="cube" style={{ marginRight: 8 }} />
                            Hubs ({importObjects.grouped.hubs.length})
                          </h5>
                          {importObjects.grouped.hubs.slice(0, 5).map((obj: any) => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                              {obj.name}
                            </Tag>
                          ))}
                          {importObjects.grouped.hubs.length > 5 && (
                            <span className="text-muted">+{importObjects.grouped.hubs.length - 5} more</span>
                          )}
                        </div>
                        
                        <div>
                          <h5 style={{ marginBottom: 8 }}>
                            <Icon icon="satellite" style={{ marginRight: 8 }} />
                            Satellites ({importObjects.grouped.satellites.length})
                          </h5>
                          {importObjects.grouped.satellites.slice(0, 5).map((obj: any) => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                              {obj.name}
                            </Tag>
                          ))}
                          {importObjects.grouped.satellites.length > 5 && (
                            <span className="text-muted">+{importObjects.grouped.satellites.length - 5} more</span>
                          )}
                        </div>
                        
                        <div>
                          <h5 style={{ marginBottom: 8 }}>
                            <Icon icon="link" style={{ marginRight: 8 }} />
                            Links ({importObjects.grouped.links.length})
                          </h5>
                          {importObjects.grouped.links.slice(0, 5).map((obj: any) => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                              {obj.name}
                            </Tag>
                          ))}
                        </div>
                        
                        <div>
                          <h5 style={{ marginBottom: 8 }}>
                            <Icon icon="layers" style={{ marginRight: 8 }} />
                            Staging ({importObjects.grouped.staging.length})
                          </h5>
                          {importObjects.grouped.staging.slice(0, 5).map((obj: any) => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                              {obj.name}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
