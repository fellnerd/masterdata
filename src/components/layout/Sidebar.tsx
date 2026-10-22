'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, Tag, Button, IconName } from '@blueprintjs/core'
import { useTheme } from '@/lib/theme-provider'
import { useAccess } from '@/components/providers/AccessProvider'

interface NavItem {
  icon: IconName
  label: string
  href: string
  badge?: number
  /** Hidden unless the user can do this somewhere (the server enforces it regardless). */
  needs?: 'write' | 'approve' | 'schema' | 'system' | 'approveOrSchema'
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navigation: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { icon: 'dashboard', label: 'Dashboard', href: '/' },
    ]
  },
  {
    title: 'Model Design',
    items: [
      { icon: 'cube', label: 'Models', href: '/models' },
      { icon: 'th', label: 'Entities', href: '/entities' },
      { icon: 'column-layout', label: 'Attributes', href: '/attributes' },
      { icon: 'eye-open', label: 'Views', href: '/views' },
      { icon: 'diagram-tree', label: 'Designer', href: '/designer' },
    ]
  },
  {
    title: 'Data Management',
    items: [
      { icon: 'database', label: 'Data Entry', href: '/data' },
      { icon: 'git-commit', label: 'Commits', href: '/commits' },
      { icon: 'history', label: 'History', href: '/history' },
    ]
  },
  {
    title: 'Operations',
    items: [
      { icon: 'play', label: 'Deploy', href: '/deploy', needs: 'approveOrSchema' },
      { icon: 'tick-circle', label: 'Validation', href: '/validation', needs: 'write' },
      { icon: 'console', label: 'Jobs', href: '/jobs', needs: 'system' },
    ]
  },
  {
    title: 'Settings',
    items: [
      { icon: 'people', label: 'Users', href: '/settings/users', needs: 'system' },
      { icon: 'shield', label: 'Permissions', href: '/settings/permissions', needs: 'system' },
      { icon: 'cog', label: 'Configuration', href: '/settings/config', needs: 'system' },
    ]
  }
]

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggleTheme, mounted } = useTheme()
  const access = useAccess()
  const visible = (item: NavItem) => {
    if (!item.needs) return true
    const c = access.capabilities
    return item.needs === 'approveOrSchema' ? c.approve || c.schema : c[item.needs]
  }

  // Determine icon and text - use consistent defaults before mount to avoid hydration mismatch
  const themeIcon = mounted ? (theme === 'dark' ? 'flash' : 'moon') : 'moon'
  const themeText = mounted ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : 'Dark Mode'

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">M</div>
        <span className="title">Master Data</span>
      </div>
      
      <nav className="sidebar-nav">
        {navigation
          .map((section) => ({ ...section, items: section.items.filter(visible) }))
          .filter((section) => section.items.length > 0)
          .map((section) => (
          <div key={section.title} className="nav-section">
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${pathname === item.href ? 'active' : ''}`}
              >
                <span className="nav-icon">
                  <Icon icon={item.icon} size={16} />
                </span>
                <span className="nav-label">{item.label}</span>
                {item.badge !== undefined && (
                  <Tag minimal round className="nav-badge">
                    {item.badge}
                  </Tag>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <Button
          minimal
          icon={themeIcon}
          onClick={toggleTheme}
          text={themeText}
          fill
        />
      </div>
    </aside>
  )
}
