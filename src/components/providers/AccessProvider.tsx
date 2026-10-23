'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export interface AccessInfo {
  loading: boolean
  /** The permission check itself failed (server error, no valid session) - NOT the same as "no access". */
  failed?: 'unauthorized' | 'error'
  email?: string
  tokenGroups?: number
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
    // A failed check must never look like "no permission": retry a few times (a restarting
    // server or a database hiccup answers 5xx for a moment), then say that the check failed.
    const load = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch('/api/me/access')
          if (res.ok) {
            const json = await res.json()
            if (!cancelled) setAccess({ ...EMPTY, ...json, loading: false })
            return
          }
          if (res.status === 401) {
            if (!cancelled) setAccess({ ...EMPTY, loading: false, failed: 'unauthorized' })
            return
          }
        } catch {
          // network hiccup - retry
        }
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      }
      if (!cancelled) setAccess({ ...EMPTY, loading: false, failed: 'error' })
    }
    load()
    return () => { cancelled = true }
  }, [])

  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
}
