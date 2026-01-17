'use client'

import { Card, Icon, IconName } from '@blueprintjs/core'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'

interface SettingsSection {
  title: string
  description: string
  icon: IconName
  href: string
  color: string
  disabled?: boolean
}

export default function SettingsPage() {
  const router = useRouter()

  const settingsSections: SettingsSection[] = [
    {
      title: 'User Management',
      description: 'Manage users, roles, and permissions',
      icon: 'people',
      href: '/settings/users',
      color: '#137cbd'
    },
    {
      title: 'Configuration',
      description: 'System settings, connections, and integrations',
      icon: 'cog',
      href: '/settings/config',
      color: '#0f9960'
    },
    {
      title: 'Data Sources',
      description: 'Configure dbt project connection for Data Vault imports',
      icon: 'database',
      href: '/settings/sources',
      color: '#9179f2',
      disabled: false
    },
    {
      title: 'Notifications',
      description: 'Email and alert preferences',
      icon: 'notifications',
      href: '/settings/notifications',
      color: '#d9822b',
      disabled: true
    }
  ]

  return (
    <>
      <Header title="Settings" breadcrumb={['Settings']} />

      <div className="page-content">
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
          gap: 16 
        }}>
          {settingsSections.map((section) => (
            <Card
              key={section.href}
              interactive={!section.disabled}
              onClick={() => !section.disabled && router.push(section.href)}
              style={{ 
                opacity: section.disabled ? 0.5 : 1,
                cursor: section.disabled ? 'not-allowed' : 'pointer'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  background: section.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Icon icon={section.icon} size={24} color="white" />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, marginBottom: 4 }}>
                    {section.title}
                    {section.disabled && (
                      <span className="text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
                        (Coming Soon)
                      </span>
                    )}
                  </h3>
                  <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                    {section.description}
                  </p>
                </div>
                <Icon icon="chevron-right" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
