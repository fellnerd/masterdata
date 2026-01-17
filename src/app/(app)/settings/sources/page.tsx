'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Card, 
  FormGroup, 
  InputGroup, 
  Button, 
  Intent, 
  Callout,
  Tag,
  Spinner,
  Icon,
  HTMLSelect,
  Switch,
  Collapse
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

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
  // dbt Profile Connection Settings
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

export default function SourcesPage() {
  const [config, setConfig] = useState<ImportSource | null>(null)
  const [objects, setObjects] = useState<ObjectsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [showDbSettings, setShowDbSettings] = useState(false)
  
  // Form state - Git Repository
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [dbtProjectPath, setDbtProjectPath] = useState('/')
  const [dbtTarget, setDbtTarget] = useState('')
  
  // Form state - Database Connection
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
  
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/import-source')
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        setGitUrl(data.git_url || '')
        setGitBranch(data.git_branch || 'main')
        setDbtProjectPath(data.dbt_project_path || '/')
        setDbtTarget(data.dbt_target || '')
        // Database settings
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
        // Expand DB settings if they have values
        if (data.db_server) {
          setShowDbSettings(true)
        }
      }
    } catch (error) {
      console.error('Failed to fetch config:', error)
    } finally {
      setLoading(false)
    }
  }, [])
  
  const fetchObjects = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/import-source/objects')
      if (res.ok) {
        const data = await res.json()
        setObjects(data)
      }
    } catch (error) {
      console.error('Failed to fetch objects:', error)
    }
  }, [])
  
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])
  
  useEffect(() => {
    if (config?.status === 'connected') {
      fetchObjects()
    }
  }, [config?.status, fetchObjects])
  
  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/import-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          git_url: gitUrl || null,
          git_branch: gitBranch || 'main',
          dbt_project_path: dbtProjectPath || '/',
          dbt_target: dbtTarget || null,
          // Database settings
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
        setConfig(data)
      }
    } catch (error) {
      console.error('Failed to save:', error)
    } finally {
      setSaving(false)
    }
  }
  
  const handleConnect = async () => {
    // Save first
    await handleSave()
    
    setConnecting(true)
    try {
      const res = await fetch('/api/settings/import-source/connect', {
        method: 'POST'
      })
      
      const data = await res.json()
      
      if (res.ok) {
        // Refresh config
        await fetchConfig()
        await fetchObjects()
      } else {
        // Refresh to get error state
        await fetchConfig()
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      await fetchConfig()
    } finally {
      setConnecting(false)
    }
  }
  
  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/settings/import-source/disconnect', {
        method: 'POST'
      })
      
      if (res.ok) {
        setObjects(null)
        await fetchConfig()
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
    }
  }
  
  const getStatusIntent = (status: string): Intent => {
    switch (status) {
      case 'connected': return Intent.SUCCESS
      case 'connecting': return Intent.WARNING
      case 'error': return Intent.DANGER
      default: return Intent.NONE
    }
  }
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return 'tick-circle'
      case 'connecting': return 'refresh'
      case 'error': return 'error'
      default: return 'offline'
    }
  }
  
  if (loading) {
    return (
      <>
        <Header 
          title="Data Sources" 
          breadcrumb={['Settings', 'Data Sources']} 
        />
        <div className="page-content" style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner />
        </div>
      </>
    )
  }
  
  return (
    <>
      <Header 
        title="Data Sources" 
        breadcrumb={['Settings', 'Data Sources']} 
      />
      
      <div className="page-content">
        <div style={{ maxWidth: 800 }}>
          
          {/* Connection Status */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Icon 
                  icon={getStatusIcon(config?.status || 'disconnected')} 
                  size={24}
                  intent={getStatusIntent(config?.status || 'disconnected')}
                />
                <div>
                  <h3 style={{ margin: 0 }}>dbt Project Connection</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Tag intent={getStatusIntent(config?.status || 'disconnected')} minimal>
                      {config?.status || 'disconnected'}
                    </Tag>
                    {config?.project_name && (
                      <Tag minimal intent={Intent.PRIMARY}>{config.project_name}</Tag>
                    )}
                    {config?.last_connected_at && (
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        Last connected: {new Date(config.last_connected_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                {config?.status === 'connected' ? (
                  <Button 
                    intent={Intent.DANGER} 
                    outlined
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button 
                    intent={Intent.SUCCESS}
                    loading={connecting}
                    disabled={!gitUrl}
                    onClick={handleConnect}
                  >
                    Connect
                  </Button>
                )}
              </div>
            </div>
          </Card>
          
          {/* Error Message */}
          {config?.status === 'error' && config.error_message && (
            <Callout intent={Intent.DANGER} style={{ marginBottom: 16 }}>
              <strong>Connection Error:</strong> {config.error_message}
            </Callout>
          )}
          
          {/* Configuration Form */}
          <Card>
            <h4 style={{ marginTop: 0 }}>Git Repository Settings</h4>
            
            <FormGroup 
              label="Git URL or Local Path" 
              labelInfo="(required)"
              helperText="Git URL (HTTPS/SSH) or local file path (e.g. /home/user/project)"
            >
              <InputGroup
                placeholder="https://github.com/org/repo.git or /path/to/project"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                disabled={config?.status === 'connected'}
                leftIcon="git-repo"
              />
            </FormGroup>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormGroup 
                label="Branch"
                helperText="Git branch to clone"
              >
                <InputGroup
                  placeholder="main"
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  disabled={config?.status === 'connected'}
                  leftIcon="git-branch"
                />
              </FormGroup>
              
              <FormGroup 
                label="dbt Project Path"
                helperText="Path to dbt_project.yml in repo"
              >
                <InputGroup
                  placeholder="/"
                  value={dbtProjectPath}
                  onChange={(e) => setDbtProjectPath(e.target.value)}
                  disabled={config?.status === 'connected'}
                  leftIcon="folder-open"
                />
              </FormGroup>
            </div>
            
            <FormGroup 
              label="dbt Target"
              helperText="Optional: dbt profile target to use"
            >
              <InputGroup
                placeholder="dev"
                value={dbtTarget}
                onChange={(e) => setDbtTarget(e.target.value)}
                disabled={config?.status === 'connected'}
              />
            </FormGroup>
          </Card>
          
          {/* Database Connection Settings */}
          <Card style={{ marginTop: 16 }}>
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                cursor: config?.status === 'connected' ? 'default' : 'pointer',
                marginBottom: showDbSettings ? 16 : 0
              }}
              onClick={() => config?.status !== 'connected' && setShowDbSettings(!showDbSettings)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon icon="database" />
                <h4 style={{ margin: 0 }}>Database Connection Settings</h4>
                {dbServer && (
                  <Tag minimal intent={Intent.SUCCESS}>Configured</Tag>
                )}
              </div>
              {config?.status !== 'connected' && (
                <Icon icon={showDbSettings ? 'chevron-up' : 'chevron-down'} />
              )}
            </div>
            
            <Collapse isOpen={showDbSettings || config?.status === 'connected'}>
              <Callout intent={Intent.PRIMARY} style={{ marginBottom: 16 }}>
                <strong>Required:</strong> Diese Einstellungen werden benötigt, um eine profiles.yml 
                für dbt zu generieren. Das ermöglicht dem Import-Worker die Verbindung zur Data Vault Datenbank.
              </Callout>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <FormGroup 
                  label="Profile Name"
                  helperText="Name des dbt Profiles (muss mit dbt_project.yml übereinstimmen)"
                >
                  <InputGroup
                    placeholder="datavault"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    disabled={config?.status === 'connected'}
                  />
                </FormGroup>
                
                <FormGroup 
                  label="Authentication Type"
                  helperText="SQL = Username/Password, CLI = Azure CLI"
                >
                  <HTMLSelect
                    value={dbAuthType}
                    onChange={(e) => setDbAuthType(e.target.value)}
                    disabled={config?.status === 'connected'}
                    fill
                  >
                    <option value="sql">SQL Authentication</option>
                    <option value="cli">Azure CLI</option>
                    <option value="msi">Managed Identity</option>
                  </HTMLSelect>
                </FormGroup>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 16 }}>
                <FormGroup 
                  label="Server"
                  labelInfo="(required)"
                  helperText="SQL Server hostname"
                >
                  <InputGroup
                    placeholder="myserver.database.windows.net"
                    value={dbServer}
                    onChange={(e) => setDbServer(e.target.value)}
                    disabled={config?.status === 'connected'}
                    leftIcon="cloud"
                  />
                </FormGroup>
                
                <FormGroup 
                  label="Port"
                  helperText="Default: 1433"
                >
                  <InputGroup
                    type="number"
                    placeholder="1433"
                    value={String(dbPort)}
                    onChange={(e) => setDbPort(parseInt(e.target.value) || 1433)}
                    disabled={config?.status === 'connected'}
                  />
                </FormGroup>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <FormGroup 
                  label="Database"
                  labelInfo="(required)"
                  helperText="Name der Data Vault Datenbank"
                >
                  <InputGroup
                    placeholder="Vault"
                    value={dbDatabase}
                    onChange={(e) => setDbDatabase(e.target.value)}
                    disabled={config?.status === 'connected'}
                    leftIcon="database"
                  />
                </FormGroup>
                
                <FormGroup 
                  label="Schema"
                  helperText="Standard-Schema für dbt"
                >
                  <InputGroup
                    placeholder="dbo"
                    value={dbSchema}
                    onChange={(e) => setDbSchema(e.target.value)}
                    disabled={config?.status === 'connected'}
                  />
                </FormGroup>
              </div>
              
              {dbAuthType === 'sql' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <FormGroup 
                    label="Username"
                    labelInfo="(required for SQL Auth)"
                  >
                    <InputGroup
                      placeholder="sqladmin"
                      value={dbUser}
                      onChange={(e) => setDbUser(e.target.value)}
                      disabled={config?.status === 'connected'}
                      leftIcon="user"
                    />
                  </FormGroup>
                  
                  <FormGroup 
                    label="Password"
                    labelInfo="(required for SQL Auth)"
                  >
                    <InputGroup
                      type="password"
                      placeholder="••••••••"
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      disabled={config?.status === 'connected'}
                      leftIcon="lock"
                    />
                  </FormGroup>
                </div>
              )}
              
              <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                <Switch
                  checked={dbEncrypt}
                  onChange={(e) => setDbEncrypt((e.target as HTMLInputElement).checked)}
                  disabled={config?.status === 'connected'}
                  label="Encrypt Connection"
                />
                <Switch
                  checked={dbTrustCert}
                  onChange={(e) => setDbTrustCert((e.target as HTMLInputElement).checked)}
                  disabled={config?.status === 'connected'}
                  label="Trust Server Certificate"
                />
              </div>
            </Collapse>
          </Card>
            
            {config?.status !== 'connected' && (
              <div style={{ marginTop: 16 }}>
                <Button 
                  intent={Intent.PRIMARY}
                  loading={saving}
                  onClick={handleSave}
                >
                  Save Configuration
                </Button>
              </div>
            )}
          
          {/* Available Objects */}
          {config?.status === 'connected' && objects && (
            <Card style={{ marginTop: 16 }}>
              <h4 style={{ marginTop: 0 }}>
                Available Objects 
                <Tag minimal style={{ marginLeft: 8 }}>{objects.count}</Tag>
              </h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                <div>
                  <h5 style={{ marginBottom: 8 }}>
                    <Icon icon="cube" style={{ marginRight: 8 }} />
                    Hubs ({objects.grouped.hubs.length})
                  </h5>
                  {objects.grouped.hubs.slice(0, 5).map((obj: any) => (
                    <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                      {obj.name}
                    </Tag>
                  ))}
                  {objects.grouped.hubs.length > 5 && (
                    <span className="text-muted">+{objects.grouped.hubs.length - 5} more</span>
                  )}
                </div>
                
                <div>
                  <h5 style={{ marginBottom: 8 }}>
                    <Icon icon="satellite" style={{ marginRight: 8 }} />
                    Satellites ({objects.grouped.satellites.length})
                  </h5>
                  {objects.grouped.satellites.slice(0, 5).map((obj: any) => (
                    <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                      {obj.name}
                    </Tag>
                  ))}
                  {objects.grouped.satellites.length > 5 && (
                    <span className="text-muted">+{objects.grouped.satellites.length - 5} more</span>
                  )}
                </div>
                
                <div>
                  <h5 style={{ marginBottom: 8 }}>
                    <Icon icon="link" style={{ marginRight: 8 }} />
                    Links ({objects.grouped.links.length})
                  </h5>
                  {objects.grouped.links.slice(0, 5).map((obj: any) => (
                    <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                      {obj.name}
                    </Tag>
                  ))}
                </div>
                
                <div>
                  <h5 style={{ marginBottom: 8 }}>
                    <Icon icon="layers" style={{ marginRight: 8 }} />
                    Staging ({objects.grouped.staging.length})
                  </h5>
                  {objects.grouped.staging.slice(0, 5).map((obj: any) => (
                    <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                      {obj.name}
                    </Tag>
                  ))}
                </div>
                
                <div>
                  <h5 style={{ marginBottom: 8 }}>
                    <Icon icon="panel-table" style={{ marginRight: 8 }} />
                    Marts ({objects.grouped.marts.length})
                  </h5>
                  {objects.grouped.marts.slice(0, 5).map((obj: any) => (
                    <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                      {obj.name}
                    </Tag>
                  ))}
                </div>
                
                {objects.grouped.pits.length > 0 && (
                  <div>
                    <h5 style={{ marginBottom: 8 }}>
                      <Icon icon="time" style={{ marginRight: 8 }} />
                      PITs ({objects.grouped.pits.length})
                    </h5>
                    {objects.grouped.pits.map((obj: any) => (
                      <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>
                        {obj.name}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
          
        </div>
      </div>
    </>
  )
}
