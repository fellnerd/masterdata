'use client'

import { useEffect, useState } from 'react'
import { Button, MenuItem, Tag } from '@blueprintjs/core'
import { Suggest } from '@blueprintjs/select'

interface ReferenceRecord {
  id: number
  business_key: string
  data: Record<string, unknown>
}

interface ReferenceInputProps {
  id?: string
  referencedEntityId: number
  referencedEntityName?: string
  value: string
  onChange: (value: string) => void
  intent?: 'primary' | 'none'
}

// Reference-type attribute editor: fuzzy-searches the referenced entity's
// staged records and only accepts values picked from that list (the value
// only ever changes via onItemSelect, never from raw typing - typing just
// filters the dropdown). Capped at 500 candidates, fetched once per
// referenced entity - fine for this app's data volumes, but a large target
// entity would need server-side search instead of fetch-all.
export function ReferenceInput({ id, referencedEntityId, referencedEntityName, value, onChange, intent }: ReferenceInputProps) {
  const [candidates, setCandidates] = useState<ReferenceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    // referencedEntityId is fixed for the lifetime of a given attribute field
    // (a new attribute means a new component instance, not a prop change on
    // this one), so the initial useState(true)/useState(false) above already
    // cover the "reset" case - no synchronous setState needed at effect start.
    let cancelled = false
    fetch(`/api/records?entity_id=${referencedEntityId}&pageSize=500`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load reference candidates')
        return res.json()
      })
      .then(json => {
        if (cancelled) return
        const rows = (json.data || []) as Array<{ id: number; business_key: string; data: unknown }>
        setCandidates(rows.map(r => ({
          id: r.id,
          business_key: r.business_key,
          data: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Record<string, unknown>
        })))
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [referencedEntityId])

  const matched = value ? candidates.find(c => c.business_key === value) : undefined
  // selectedItem only controls what text is shown in the input - it doesn't
  // need to be part of `candidates`. A synthetic item lets an existing value
  // that no longer matches anything (stale/legacy reference) still display
  // as text instead of silently going blank.
  const selectedItem: ReferenceRecord | null = value
    ? (matched ?? { id: -1, business_key: value, data: {} })
    : null
  const isUnmatched = !!value && !matched && !loading

  return (
    <>
      <Suggest<ReferenceRecord>
        items={candidates}
        fill
        disabled={loading}
        resetOnClose
        selectedItem={selectedItem}
        itemsEqual="business_key"
        inputProps={{
          id,
          intent: isUnmatched ? 'warning' : intent,
          placeholder: loading ? 'Lade Datensätze...' : `${referencedEntityName || 'Datensatz'} suchen...`,
          rightElement: value ? (
            <Button icon="cross" minimal small onClick={() => onChange('')} title="Referenz entfernen" />
          ) : undefined
        }}
        itemPredicate={(query, item) => item.business_key.toLowerCase().includes(query.toLowerCase())}
        itemRenderer={(item, { handleClick, handleFocus, modifiers }) => {
          if (!modifiers.matchesPredicate) return null
          return (
            <MenuItem
              key={item.id}
              text={item.business_key}
              roleStructure="listoption"
              active={modifiers.active}
              onClick={handleClick}
              onFocus={handleFocus}
            />
          )
        }}
        onItemSelect={(item) => onChange(item.business_key)}
        inputValueRenderer={(item) => item.business_key}
        noResults={
          <MenuItem
            disabled
            text={loadError ? 'Fehler beim Laden' : candidates.length === 0 ? 'Keine Datensätze vorhanden' : 'Keine Treffer'}
          />
        }
      />
      {isUnmatched && (
        <Tag intent="warning" minimal style={{ marginTop: 6 }}>
          &quot;{value}&quot; wurde in {referencedEntityName || 'der referenzierten Entity'} nicht gefunden
        </Tag>
      )}
    </>
  )
}
