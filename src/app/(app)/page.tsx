'use client'

import { useState, useEffect } from 'react'
import { Icon, Tag, Card, Button, Spinner } from '@blueprintjs/core'
import { Header } from '@/components/layout/Header'
import Link from 'next/link'

interface DashboardStats {
  models: number
  entities: number
  records: number
  pendingCommits: number
  dqScore: number
  runningJobs: number
}

interface RecentActivity {
  id: string
  action: string
  entity: string
  user: string
  time: string
  icon: string
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    models: 0,
    entities: 0,
    records: 0,
    pendingCommits: 0,
    dqScore: 0,
    runningJobs: 0
  })
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'checking'>('checking')

  const mapOperationToIcon = (op: string) => {
    switch (op?.toUpperCase()) {
      case 'INSERT': return 'add'
      case 'UPDATE': return 'edit'
      case 'DELETE': return 'trash'
      case 'COMMIT': return 'git-commit'
      default: return 'info-sign'
    }
  }

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`
    return date.toLocaleDateString()
  }

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)
        
        const [modelsRes, entitiesRes, historyRes] = await Promise.all([
          fetch('/api/models'),
          fetch('/api/entities'),
          fetch('/api/history?limit=5')
        ])
        
        if (modelsRes.ok && entitiesRes.ok) {
          const modelsData = await modelsRes.json()
          const entitiesData = await entitiesRes.json()
          
          // Calculate total records from entity counts (if available)
          const totalRecords = (entitiesData.data || []).reduce(
            (sum: number, e: any) => sum + (e.record_count || 0), 0
          )
          
          setStats({
            models: modelsData.total || modelsData.data?.length || 0,
            entities: entitiesData.total || entitiesData.data?.length || 0,
            records: totalRecords,
            pendingCommits: 0, // TODO: fetch from commits API
            dqScore: 98, // TODO: fetch from validation API
            runningJobs: 0 // TODO: fetch from jobs API
          })
          setDbStatus('connected')
        } else {
          setDbStatus('error')
        }

        if (historyRes.ok) {
           const historyData = await historyRes.json()
           const mappedActivity = historyData.slice(0, 5).map((h: any) => ({
             id: h.id.toString(),
             action: h.operation.charAt(0) + h.operation.slice(1).toLowerCase(),
             entity: `${h.entity_name} (${h.record_key})`,
             user: h.changed_by || 'system',
             time: formatTimeAgo(h.changed_at),
             icon: mapOperationToIcon(h.operation)
           }))
           setRecentActivity(mappedActivity)
        }

      } catch (err) {
        console.error('Failed to fetch stats:', err)
        setDbStatus('error')
      } finally {
        setLoading(false)
      }
    }
    
    fetchStats()
  }, [])

  const tiles = [
    {
      id: 'models',
      title: 'Models',
      icon: 'cube',
      count: stats.models,
      label: 'Active Models',
      status: 'success' as const,
      statusText: stats.models > 0 ? 'All healthy' : 'None defined',
      href: '/models',
      color: '#137cbd'
    },
    {
      id: 'entities',
      title: 'Entities',
      icon: 'th',
      count: stats.entities,
      label: 'Total Entities',
      status: 'success' as const,
      statusText: `${stats.entities} defined`,
      href: '/entities',
      color: '#0d8050'
    },
    {
      id: 'records',
      title: 'Records',
      icon: 'database',
      count: stats.records,
      label: 'Master Records',
      status: 'primary' as const,
      statusText: 'In staging',
      href: '/data',
      color: '#752f75'
    },
    {
      id: 'commits',
      title: 'Commits',
      icon: 'git-commit',
      count: stats.pendingCommits,
      label: 'Pending Approval',
      status: stats.pendingCommits > 0 ? 'warning' as const : 'success' as const,
      statusText: stats.pendingCommits > 0 ? 'Requires review' : 'None pending',
      href: '/commits',
      color: '#bf7326'
    },
    {
      id: 'validation',
      title: 'Validation',
      icon: 'tick-circle',
      count: stats.dqScore,
      label: 'DQ Score %',
      status: stats.dqScore >= 90 ? 'success' as const : 'warning' as const,
      statusText: stats.dqScore >= 90 ? 'Good quality' : 'Needs attention',
      href: '/validation',
      color: '#0d8050'
    },
    {
      id: 'jobs',
      title: 'Jobs',
      icon: 'console',
      count: stats.runningJobs,
      label: 'Running',
      status: 'success' as const,
      statusText: stats.runningJobs > 0 ? 'In progress' : 'All complete',
      href: '/jobs',
      color: '#5c7080'
    }
  ]

  return (
    <>
      <Header title="Dashboard" breadcrumb={['Home']} />
      
      <div className="page-content">
        {/* Quick Actions */}
        <div className="section-header">
          <h2>Quick Actions</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/entities"><Button icon="add" intent="primary">New Entity</Button></Link>
            <Link href="/data"><Button icon="database">Enter Data</Button></Link>
            <Link href="/deploy"><Button icon="play">Deploy</Button></Link>
          </div>
        </div>

        {/* Dashboard Tiles */}
        <div className="dashboard-tiles">
          {tiles.map((tile) => (
            <Link key={tile.id} href={tile.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="dashboard-tile">
                <div className="tile-header">
                  <div className="tile-icon" style={{ background: `${tile.color}20`, color: tile.color }}>
                    <Icon icon={tile.icon as any} size={20} />
                  </div>
                  <span className="tile-title">{tile.title}</span>
                </div>
                <div className="tile-count">
                  {loading ? <Spinner size={20} /> : tile.count.toLocaleString('de-DE')}
                </div>
                <div className="tile-label">{tile.label}</div>
                {tile.status && !loading && (
                  <div className="tile-status">
                    <Icon 
                      icon={tile.status === 'success' ? 'tick-circle' : tile.status === 'warning' ? 'warning-sign' : 'info-sign'} 
                      size={14}
                      intent={tile.status}
                    />
                    <span>{tile.statusText}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Recent Activity */}
        <div className="section-header">
          <h2>Recent Activity</h2>
          <Button minimal rightIcon="arrow-right">View All</Button>
        </div>

        <Card style={{ padding: 0 }}>
          <table className="bp5-html-table bp5-html-table-striped" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Action</th>
                <th>Entity</th>
                <th>User</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((activity) => (
                <tr key={activity.id}>
                  <td>
                    <Icon icon={activity.icon as any} size={14} />
                  </td>
                  <td>{activity.action}</td>
                  <td><strong>{activity.entity}</strong></td>
                  <td>
                    <Tag minimal>{activity.user}</Tag>
                  </td>
                  <td className="text-muted">{activity.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* System Status */}
        <div className="section-header" style={{ marginTop: 24 }}>
          <h2>System Status</h2>
        </div>

        <div className="card-grid">
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Database Connection</span>
              <Tag 
                intent={dbStatus === 'connected' ? 'success' : dbStatus === 'checking' ? 'none' : 'danger'} 
                minimal
              >
                {dbStatus === 'connected' ? 'Connected' : dbStatus === 'checking' ? 'Checking...' : 'Error'}
              </Tag>
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>Azure SQL: sql-datavault-weu-001</div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>dbt Version</span>
              <Tag minimal>1.11.2</Tag>
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>Last run: 2 hours ago</div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Job Queue</span>
              <Tag intent="success" minimal>Idle</Tag>
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>{stats.runningJobs} jobs pending</div>
          </Card>
        </div>
      </div>
    </>
  )
}
