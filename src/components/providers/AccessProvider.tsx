'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export interface AccessInfo {
  loading: boolean
  email?: string
  hasAccess: boolean
  capabilities: { write: boolean; approve: boolean; schema: boolean; system: boolean }
  grants: Array<{ role: string; scope: string; target: string | null }>
}

const EMPTY: AccessInfo = {
  loading: true,
  hasAccess: false,
  capabilities: { write: false, approve: false, schema: false, system: false },
  grants: [],
}

const AccessContext = createContext<AccessInfo>(EMPTY)

export function useAccess(): AccessInfo {
  return useContext(AccessContext)
}

// Loads what the signed-in user may do once; the server enforces it on every
// request anyway - this only drives the menu and the "no access" screen.
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<AccessInfo>(EMPTY)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me/access')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(json => { if (!cancelled) setAccess({ ...EMPTY, ...json, loading: false }) })
      .catch(() => { if (!cancelled) setAccess({ ...EMPTY, loading: false }) })
    return () => { cancelled = true }
  }, [])

  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
}
