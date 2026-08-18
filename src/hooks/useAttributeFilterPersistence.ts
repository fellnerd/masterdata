'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'

const ATTR_PREFIX = 'attr.'

// Dynamic-key counterpart to useFilterPersistence: manages the whole set of
// `attr.<code>[.min|.max|.from|.to]` query params as one Record<string,string>
// map, since attribute codes (and therefore filter param names) vary per
// selected entity rather than being a single fixed key. Same
// URL-param-first / localStorage-fallback priority; localStorage is
// namespaced per entity so filters don't leak across entity selections.
// Must be used inside a component wrapped in <Suspense> (useSearchParams).
export function useAttributeFilterPersistence(
  entityId: number | undefined
): [Record<string, string>, (next: Record<string, string>) => void] {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const [filters, setFilters] = useState<Record<string, string>>({})

  const storageKey = entityId ? `mds_filter_data_attr_${entityId}` : null

  useEffect(() => {
    if (!storageKey) {
      setFilters({})
      return
    }

    const fromUrl: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith(ATTR_PREFIX)) fromUrl[key] = value
    })

    if (Object.keys(fromUrl).length > 0) {
      setFilters(fromUrl)
      try {
        localStorage.setItem(storageKey, JSON.stringify(fromUrl))
      } catch {
        // localStorage unavailable - filter still works for this session
      }
      return
    }

    try {
      const stored = localStorage.getItem(storageKey)
      setFilters(stored ? JSON.parse(stored) : {})
    } catch {
      setFilters({})
    }
    // Only re-run when the entity changes - re-reading on every searchParams
    // change would fight with setAndPersist's own router.replace below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const setAndPersist = useCallback((next: Record<string, string>) => {
    setFilters(next)

    if (storageKey) {
      try {
        if (Object.keys(next).length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } else {
          localStorage.removeItem(storageKey)
        }
      } catch {
        // ignore
      }
    }

    const params = new URLSearchParams(searchParams.toString())
    Array.from(params.keys())
      .filter(k => k.startsWith(ATTR_PREFIX))
      .forEach(k => params.delete(k))
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, pathname])

  return [filters, setAndPersist]
}
