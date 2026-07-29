'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Button,
  Card,
  FormGroup,
  InputGroup,
  TextArea,
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
  RadioGroup,
  Radio
} from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'

type ProfileInputMode = 'manual' | 'upload'
type GitAuthType = 'none' | 'ssh_key'

interface WorkflowInfo {
  filename: string
  name: string
  path: string
}

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
  db_encrypt: boolean | null
  db_trust_cert: boolean | null
  git_auth_type: GitAuthType
  workflows_json: string | null
  has_db_password: boolean
  has_git_ssh_private_key: boolean
  has_github_api_token: boolean
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
    hubs: Array<{ name: string }>
    satellites: Array<{ name: string }>
    links: Array<{ name: string }>
    staging: Array<{ name: string }>
    marts: Array<{ name: string }>
    pits: Array<{ name: string }>
  }
}

function parseGithubRepo(gitUrl: string): { owner: string; repo: string } | null {
  const sshMatch = gitUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }
  const httpsMatch = gitUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }
  return null
}

export default function ConfigPage() {
  const [selectedTab, setSelectedTab] = useState('connections')

  // Import Source State
  const [importConfig, setImportConfig] = useState<ImportSource | null>(null)
  const [importObjects, setImportObjects] = useState<ObjectsResponse | null>(null)
  const [loadingImport, setLoadingImport] = useState(false)
  const [savingImport, setSavingImport] = useState(false)
  const [connectingImport, setConnectingImport] = useState(false)
  const [showDbSettings, setShowDbSettings] = useState(false)
  const [triggeringWorkflow, setTriggeringWorkflow] = useState<string | null>(null)
  const [workflowMessage, setWorkflowMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)

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

  // Git auth + GitHub Actions
  const [gitAuthType, setGitAuthType] = useState<GitAuthType>('none')
  const [sshPrivateKey, setSshPrivateKey] = useState('')
  const [githubApiToken, setGithubApiToken] = useState('')

  // Profile Input Mode
  const [profileInputMode, setProfileInputMode] = useState<ProfileInputMode>('manual')
  const [uploadedProfileContent, setUploadedProfileContent] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchImportConfig = useCallback(async () => {
    setLoadingImport(true)
    try {
      const res = await fetch('/api/settings/import-source')
      if (res.ok) {
        const data: ImportSource = await res.json()
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
        setDbEncrypt(data.db_encrypt !== false)
        setDbTrustCert(data.db_trust_cert === true)
        setGitAuthType(data.git_auth_type || 'none')
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

  useEffect(() => {
    fetchImportConfig()
  }, [fetchImportConfig])

  useEffect(() => {
    if (importConfig?.status === 'connected') {
      fetchImportObjects()
    }
  }, [importConfig?.status, fetchImportObjects])

  const workflows: WorkflowInfo[] = importConfig?.workflows_json ? JSON.parse(importConfig.workflows_json) : []
  const githubRepo = gitUrl ? parseGithubRepo(gitUrl) : null

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
          db_password: dbPassword || undefined, // omit = keep existing
          db_encrypt: dbEncrypt,
          db_trust_cert: dbTrustCert,
          git_auth_type: gitAuthType,
          git_ssh_private_key: sshPrivateKey || undefined, // omit = keep existing
          github_api_token: githubApiToken || undefined // omit = keep existing
        })
      })
      if (res.ok) {
        const data = await res.json()
        setImportConfig(data)
        setDbPassword('')
        setSshPrivateKey('')
        setGithubApiToken('')
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

  const handleTriggerWorkflow = async (filename: string) => {
    setTriggeringWorkflow(filename)
    setWorkflowMessage(null)
    try {
      const res = await fetch('/api/settings/import-source/workflows/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to trigger workflow')
      setWorkflowMessage({ type: 'success', text: json.message })
    } catch (err) {
      setWorkflowMessage({ type: 'danger', text: err instanceof Error ? err.message : 'Failed to trigger workflow' })
    } finally {
      setTriggeringWorkflow(null)
    }
  }

  const handleProfileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      setUploadedProfileContent(content)

      const serverMatch = content.match(/server:\s*['"]?([^\s'"]+)['"]?/i)
      const portMatch = content.match(/port:\s*(\d+)/i)
      const databaseMatch = content.match(/database:\s*['"]?([^\s'"]+)['"]?/i)
      const schemaMatch = content.match(/schema:\s*['"]?([^\s'"]+)['"]?/i)
      const userMatch = content.match(/user:\s*['"]?([^\s'"]+)['"]?/i)
      const passwordMatch = content.match(/password:\s*['"]?([^\s'"]+)['"]?/i)
      const authMatch = content.match(/authentication:\s*['"]?([^\s'"]+)['"]?/i)
      const profileNameMatch = content.match(/^(\w+):/m)

      if (profileNameMatch) setProfileName(profileNameMatch[1])
      if (serverMatch) setDbServer(serverMatch[1])
      if (portMatch) setDbPort(parseInt(portMatch[1]))
      if (databaseMatch) setDbDatabase(databaseMatch[1])
      if (schemaMatch) setDbSchema(schemaMatch[1])
      if (userMatch) setDbUser(userMatch[1])
      if (passwordMatch) setDbPassword(passwordMatch[1])
      if (authMatch) setDbAuthType(authMatch[1])

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
          <Tab id="connections" title="dbt Project" />
          <Tab id="general" title="General" />
          <Tab id="workflow" title="Workflow" />
        </Tabs>

        <div style={{ marginTop: 24 }}>
          {/* General Settings - preview only, not yet persisted anywhere */}
          {selectedTab === 'general' && (
            <Card>
              <Callout icon="info-sign" style={{ marginBottom: 16 }}>
                Diese Sektion ist noch nicht an ein Backend angebunden - Eingaben werden aktuell nicht gespeichert.
              </Callout>

              <h3 style={{ marginTop: 0 }}>Display Settings</h3>

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
            </Card>
          )}

          {/* Workflow Settings - preview only, not yet persisted anywhere */}
          {selectedTab === 'workflow' && (
            <Card>
              <Callout icon="info-sign" style={{ marginBottom: 16 }}>
                Diese Sektion ist noch nicht an ein Backend angebunden - Eingaben werden aktuell nicht gespeichert.
                Commit-Genehmigung wird aktuell direkt auf der Commits-Seite gehandhabt.
              </Callout>

              <h3 style={{ marginTop: 0 }}>Approval Workflow (Vorschau)</h3>

              <Switch label="Require approval for commits" defaultChecked disabled />
              <Switch label="Auto-deploy after approval" style={{ marginTop: 8 }} disabled />

              <Divider style={{ margin: '24px 0' }} />

              <h3>Data Quality (Vorschau)</h3>
              <Switch label="Enable DQ validation before commit" disabled />
            </Card>
          )}

          {/* dbt Project / Connections */}
          {selectedTab === 'connections' && (
            <>
              {loadingImport ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                  <Spinner />
                </div>
              ) : (
                <>
                  <Callout intent={Intent.PRIMARY} icon="info-sign" style={{ marginBottom: 16 }}>
                    Diese Seite liest die Struktur eines dbt-Projekts (Git-Repo oder lokaler Pfad) rein lesend aus,
                    um Data-Vault-Objekte fuer das Import-Mapping bereitzustellen. dbt-Befehle (run/test/compile) werden
                    hier bewusst nicht ausgefuehrt - das passiert ueber die Deploy/Jobs-Seiten dieser App.
                  </Callout>

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
                            disabled={!gitUrl}
                            onClick={handleConnectImport}
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>

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
                      helperText="Git URL (https://github.com/org/repo.git, git@github.com:org/repo.git) oder lokaler Pfad (/path/to/project)"
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

                      <FormGroup label="dbt Project Path" helperText="Pfad zu dbt_project.yml relativ zum Repo-Root">
                        <InputGroup
                          placeholder="/"
                          value={importDbtProjectPath}
                          onChange={(e) => setImportDbtProjectPath(e.target.value)}
                          disabled={importConfig?.status === 'connected'}
                          leftIcon="folder-open"
                        />
                      </FormGroup>

                      <FormGroup label="dbt Target" helperText="Aus profiles.yml des Zielprojekts">
                        <InputGroup
                          placeholder="z.B. dev"
                          value={importDbtTarget}
                          onChange={(e) => setImportDbtTarget(e.target.value)}
                          disabled={importConfig?.status === 'connected'}
                        />
                      </FormGroup>
                    </div>

                    <Divider style={{ margin: '16px 0' }} />

                    <FormGroup label="Git-Authentifizierung" helperText="Nur noetig fuer private Repos via Git-URL (nicht fuer lokale Pfade)">
                      <RadioGroup
                        selectedValue={gitAuthType}
                        onChange={(e) => setGitAuthType((e.target as HTMLInputElement).value as GitAuthType)}
                        disabled={importConfig?.status === 'connected'}
                        inline
                      >
                        <Radio label="Keine (oeffentliches Repo / lokaler Pfad)" value="none" />
                        <Radio label="SSH Deploy Key" value="ssh_key" />
                      </RadioGroup>
                    </FormGroup>

                    {gitAuthType === 'ssh_key' && importConfig?.status !== 'connected' && (
                      <FormGroup
                        label="SSH Private Key"
                        helperText="Read-only Deploy Key des Repos. Wird serverseitig gespeichert und nach dem Speichern nie wieder angezeigt."
                      >
                        {importConfig?.has_git_ssh_private_key && !sshPrivateKey && (
                          <Tag intent={Intent.SUCCESS} minimal style={{ marginBottom: 8 }}>Key hinterlegt - zum Aendern neuen Key einfuegen</Tag>
                        )}
                        <TextArea
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                          value={sshPrivateKey}
                          onChange={(e) => setSshPrivateKey(e.target.value)}
                          fill
                          rows={6}
                          style={{ fontFamily: 'monospace', fontSize: 11 }}
                        />
                      </FormGroup>
                    )}
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
                        Diese Einstellungen werden benoetigt, um eine <code>profiles.yml</code> fuer dieses dbt-Projekt zu generieren.
                      </Callout>

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
                              <Button icon="upload" onClick={() => fileInputRef.current?.click()}>
                                Datei auswaehlen
                              </Button>
                              {uploadedProfileContent && (
                                <Tag intent={Intent.SUCCESS} icon="tick">Datei geladen - Werte extrahiert</Tag>
                              )}
                            </div>
                          </FormGroup>
                        </Card>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <FormGroup label="Profile Name" helperText="Muss mit dbt_project.yml uebereinstimmen">
                          <InputGroup
                            placeholder="z.B. datavault"
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
                            placeholder="z.B. myserver.database.windows.net"
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
                            placeholder="z.B. datavault-dev"
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
                              placeholder="z.B. sqladmin"
                              value={dbUser}
                              onChange={(e) => setDbUser(e.target.value)}
                              disabled={importConfig?.status === 'connected'}
                              leftIcon="user"
                            />
                          </FormGroup>

                          <FormGroup label="Password" labelInfo="(required for SQL Auth)">
                            {importConfig?.has_db_password && !dbPassword && (
                              <Tag intent={Intent.SUCCESS} minimal style={{ marginBottom: 4 }}>Gesetzt - zum Aendern neu eingeben</Tag>
                            )}
                            <InputGroup
                              type="password"
                              placeholder="********"
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

                  {/* GitHub Actions */}
                  {githubRepo && (
                    <Card style={{ marginBottom: 16 }}>
                      <h4 style={{ marginTop: 0 }}>
                        <Icon icon="git-branch" style={{ marginRight: 8 }} />
                        GitHub Actions
                      </h4>

                      <FormGroup
                        label="GitHub API Token"
                        helperText='Optional - nur noetig, um Workflows von hier aus zu triggern (Scope "actions:write"). Ein Read-only Deploy Key reicht dafuer nicht aus, der kann nur clonen.'
                      >
                        {importConfig?.has_github_api_token && !githubApiToken && (
                          <Tag intent={Intent.SUCCESS} minimal style={{ marginBottom: 4 }}>Token gesetzt - zum Aendern neu eingeben</Tag>
                        )}
                        <InputGroup
                          type="password"
                          placeholder="ghp_..."
                          value={githubApiToken}
                          onChange={(e) => setGithubApiToken(e.target.value)}
                          leftIcon="key"
                        />
                      </FormGroup>

                      {workflowMessage && (
                        <Callout intent={Intent[workflowMessage.type.toUpperCase() as 'SUCCESS' | 'DANGER']} style={{ marginBottom: 12 }}>
                          {workflowMessage.text}
                        </Callout>
                      )}

                      {importConfig?.status !== 'connected' ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Nach dem Connect werden hier automatisch alle Workflows aus <code>.github/workflows</code> aufgelistet.
                        </div>
                      ) : workflows.length === 0 ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>Keine Workflows in .github/workflows gefunden.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {workflows.map(wf => (
                            <div key={wf.filename} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '8px 12px', border: '1px solid var(--view-card-border, #ddd)', borderRadius: 4
                            }}>
                              <div>
                                <div style={{ fontWeight: 500 }}>{wf.name}</div>
                                <code style={{ fontSize: 11, color: 'var(--view-card-text-faint)' }}>{wf.path}</code>
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <Button
                                  small
                                  icon="share"
                                  onClick={() => window.open(`https://github.com/${githubRepo.owner}/${githubRepo.repo}/actions/workflows/${wf.filename}`, '_blank')}
                                >
                                  In GitHub oeffnen
                                </Button>
                                <Button
                                  small
                                  icon="play"
                                  intent={Intent.PRIMARY}
                                  loading={triggeringWorkflow === wf.filename}
                                  disabled={!importConfig?.has_github_api_token}
                                  title={!importConfig?.has_github_api_token ? 'GitHub API Token erforderlich' : `Trigger auf Branch ${gitBranch}`}
                                  onClick={() => handleTriggerWorkflow(wf.filename)}
                                >
                                  Trigger
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}

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
                          {importObjects.grouped.hubs.slice(0, 5).map(obj => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>{obj.name}</Tag>
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
                          {importObjects.grouped.satellites.slice(0, 5).map(obj => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>{obj.name}</Tag>
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
                          {importObjects.grouped.links.slice(0, 5).map(obj => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>{obj.name}</Tag>
                          ))}
                        </div>

                        <div>
                          <h5 style={{ marginBottom: 8 }}>
                            <Icon icon="layers" style={{ marginRight: 8 }} />
                            Staging ({importObjects.grouped.staging.length})
                          </h5>
                          {importObjects.grouped.staging.slice(0, 5).map(obj => (
                            <Tag key={obj.name} minimal style={{ marginRight: 4, marginBottom: 4 }}>{obj.name}</Tag>
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
