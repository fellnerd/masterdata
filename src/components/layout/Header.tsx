'use client'

import { Button, Menu, MenuDivider, MenuItem, Tag } from '@blueprintjs/core'
import { useTheme } from '@/lib/theme-provider'
import { signOut, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useEffect } from 'react'

interface HeaderProps {
  title: string
  breadcrumb?: string[]
  actions?: React.ReactNode
}

export function Header({ title, breadcrumb, actions }: HeaderProps) {
  const { theme, toggleTheme } = useTheme()
  const { data: session, status } = useSession()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleSignOut = async () => {
    setMenuOpen(false)
    await signOut({ redirect: false })
    router.push('/login')
  }

  // Show loading placeholder until session is loaded to prevent hydration mismatch
  const userName = status === 'loading' ? '...' : (session?.user?.name || 'Admin')

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">{title}</h1>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="breadcrumb">
            {breadcrumb.map((item, index) => (
              <span key={index}>
                {index > 0 && ' / '}
                {item}
              </span>
            ))}
          </nav>
        )}
      </div>

      {actions && (
        <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
          {actions}
        </div>
      )}

      <div className="header-right">
        <Button
          minimal
          small
          icon={theme === 'dark' ? 'flash' : 'moon'}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        />
        
        <Button minimal small icon="notifications" title="Notifications">
          <Tag minimal round intent="primary" style={{ marginLeft: 4 }}>3</Tag>
        </Button>

        <div ref={menuRef} style={{ position: 'relative' }}>
          <Button 
            minimal 
            small 
            icon="user" 
            rightIcon="caret-down"
            onClick={() => setMenuOpen(!menuOpen)}
            active={menuOpen}
          >
            {userName}
          </Button>
          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              zIndex: 1000,
            }}>
              <Menu>
                <MenuItem 
                  icon="person" 
                  text="Profile" 
                  onClick={() => { setMenuOpen(false); router.push('/settings/profile'); }} 
                />
                <MenuItem 
                  icon="cog" 
                  text="Settings" 
                  onClick={() => { setMenuOpen(false); router.push('/settings/config'); }} 
                />
                <MenuDivider />
                <MenuItem 
                  icon="log-out" 
                  text="Sign out" 
                  intent="danger" 
                  onClick={handleSignOut} 
                />
              </Menu>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
