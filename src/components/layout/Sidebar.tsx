'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, Tag, Button, IconName } from '@blueprintjs/core'
import { useTheme } from '@/lib/theme-provider'

interface NavItem {
  icon: IconName
  label: string
  href: string
  badge?: number
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
      { icon: 'play', label: 'Deploy', href: '/deploy' },
      { icon: 'tick-circle', label: 'Validation', href: '/validation' },
      { icon: 'console', label: 'Jobs', href: '/jobs' },
    ]
  },
  {
    title: 'Settings',
    items: [
      { icon: 'people', label: 'Users', href: '/settings/users' },
      { icon: 'cog', label: 'Configuration', href: '/settings/config' },
    ]
  }
]

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggleTheme, mounted } = useTheme()

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
        {navigation.map((section) => (
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
