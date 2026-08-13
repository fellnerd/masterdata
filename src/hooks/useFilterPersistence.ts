'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// Resolves a filter's initial value with priority URL query param > last
// value stored in localStorage > default, then persists every subsequent
// change to localStorage so the filter survives navigation and refresh.
// Must be used inside a component wrapped in <Suspense> (useSearchParams
// requirement), e.g. Entities/Attributes/Data pages.
export function useFilterPersistence(
  paramName: string,
  storageKey: string,
  defaultValue: string = ''
): [string, (value: string) => void] {
  const searchParams = useSearchParams()
  const [value, setValue] = useState(defaultValue)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized) return
    const fromUrl = searchParams.get(paramName)
    if (fromUrl) {
      setValue(fromUrl)
      try {
        localStorage.setItem(storageKey, fromUrl)
      } catch {
        // localStorage unavailable (private browsing etc.) - filter still
        // works for this session, just won't persist
      }
    } else {
      try {
        const stored = localStorage.getItem(storageKey)
        if (stored) setValue(stored)
      } catch {
        // ignore
      }
    }
    setInitialized(true)
  }, [searchParams, paramName, storageKey, initialized])

  const setAndPersist = (next: string) => {
    setValue(next)
    try {
      if (next) {
        localStorage.setItem(storageKey, next)
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch {
      // ignore
    }
  }

  return [value, setAndPersist]
}
