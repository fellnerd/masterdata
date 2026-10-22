'use client'

import { useEffect, useMemo, useState } from 'react'
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
  /** Attribute of the referenced entity shown in the list; omitted = its business key. The stored value is always the business key. */
  displayAttribute?: string | null
  /**
   * Cascade: only offer records whose `attribute` equals `value`. Pass undefined while the
   * parent is still empty (everything is offered then). The parent re-mounts this component
   * (via `key`) when that value changes - see data/page.tsx.
   */
  cascadeFilter?: { attribute: string; value: string }
  /**
   * The referencing attribute's id. With it the choices come from /api/reference-lookup (business key + label
   * only, allowed for whoever may read that attribute's own entity - so values of an entity in another model
   * can be picked without being able to browse it). Without it the referenced entity's records are read directly.
   */
  lookupAttributeId?: number
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v))

// Reference-type attribute editor: fuzzy-searches the referenced entity's
// staged records and only accepts values picked from that list (the value
// only ever changes via onItemSelect, never from raw typing - typing just
// filters the dropdown). Capped at 500 candidates, fetched once per
// referenced entity - fine for this app's data volumes, but a large target
// entity would need server-side search instead of fetch-all. With a cascade
// filter the server already narrows the list to the selected parent.
export function ReferenceInput({
  id, referencedEntityId, referencedEntityName, value, onChange, intent,
  displayAttribute, cascadeFilter, lookupAttributeId,
}: ReferenceInputProps) {
  const [candidates, setCandidates] = useState<ReferenceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const filterAttribute = cascadeFilter?.attribute
  const filterValue = cascadeFilter?.value

  useEffect(() => {
    // referencedEntityId and the cascade filter are fixed for the lifetime of
    // a given component instance (a different attribute or a different parent
    // value means a new instance - the parent sets `key`), so the initial
    // useState(true)/useState(false) above already cover the "reset" case - no
    // synchronous setState needed at effect start.
    let cancelled = false
    const filter = filterAttribute && filterValue
      ? `&attr.${encodeURIComponent(filterAttribute)}.exact=${encodeURIComponent(filterValue)}`
      : ''
    const url = lookupAttributeId
      ? `/api/reference-lookup?attribute_id=${lookupAttributeId}${filterValue ? `&parent_value=${encodeURIComponent(filterValue)}` : ''}`
      : `/api/records?entity_id=${referencedEntityId}&pageSize=500${filter}`
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load reference candidates')
        return res.json()
      })
      .then(json => {
        if (cancelled) return
        if (lookupAttributeId) {
          // already (business key, label): put the label where labelOf() looks for it
          const options = (json.data || []) as Array<{ business_key: string; label: string }>
          setCandidates(options.map((o, i) => ({
            id: i,
            business_key: o.business_key,
            data: displayAttribute ? { [displayAttribute]: o.label } : {},
          })))
          return
        }
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
  }, [referencedEntityId, filterAttribute, filterValue, lookupAttributeId, displayAttribute])

  const valueOf = (c: ReferenceRecord) => c.business_key
  const labelOf = (c: ReferenceRecord) => {
    const label = displayAttribute ? text(c.data[displayAttribute]) : ''
    return label || valueOf(c)
  }

  // Sorted by what the user reads.
  const items = useMemo(
    () => [...candidates]
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: 'base' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, displayAttribute]
  )

  const matched = value ? items.find(c => valueOf(c) === value) : undefined
  // selectedItem only controls what text is shown in the input - it doesn't
  // need to be part of `items`. A synthetic item lets an existing value
  // that no longer matches anything (stale/legacy reference, or a parent that
  // changed underneath it) still display as text instead of silently going blank.
  const selectedItem: ReferenceRecord | null = value
    ? (matched ?? { id: -1, business_key: value, data: {} })
    : null
  const isUnmatched = !!value && !matched && !loading

  return (
    <>
      <Suggest<ReferenceRecord>
        items={items}
        fill
        disabled={loading}
        resetOnClose
        selectedItem={selectedItem}
        itemsEqual={(a, b) => valueOf(a) === valueOf(b)}
        inputProps={{
          id,
          intent: isUnmatched ? 'warning' : intent,
          placeholder: loading ? 'Lade Datensätze...' : `${referencedEntityName || 'Datensatz'} suchen...`,
          rightElement: value ? (
            <Button icon="cross" minimal small onClick={() => onChange('')} title="Referenz entfernen" />
          ) : undefined
        }}
        itemPredicate={(query, item) => {
          const q = query.toLowerCase()
          return labelOf(item).toLowerCase().includes(q) || valueOf(item).toLowerCase().includes(q)
        }}
        itemRenderer={(item, { handleClick, handleFocus, modifiers }) => {
          if (!modifiers.matchesPredicate) return null
          const label = labelOf(item)
          const val = valueOf(item)
          return (
            <MenuItem
              key={item.id}
              text={label}
              // the stored value, when the list shows something else
              label={label !== val ? val : undefined}
              roleStructure="listoption"
              active={modifiers.active}
              onClick={handleClick}
              onFocus={handleFocus}
            />
          )
        }}
        onItemSelect={(item) => onChange(valueOf(item))}
        inputValueRenderer={(item) => labelOf(item)}
        noResults={
          <MenuItem
            disabled
            text={
              loadError ? 'Fehler beim Laden'
                : items.length === 0
                  ? (cascadeFilter ? 'Keine Einträge zur gewählten Auswahl' : 'Keine Datensätze vorhanden')
                  : 'Keine Treffer'
            }
          />
        }
      />
      {isUnmatched && (
        <Tag intent="warning" minimal style={{ marginTop: 6 }}>
          {cascadeFilter
            ? <>&quot;{value}&quot; passt nicht zur gewählten Auswahl in {referencedEntityName || 'der referenzierten Entity'}</>
            : <>&quot;{value}&quot; wurde in {referencedEntityName || 'der referenzierten Entity'} nicht gefunden</>}
        </Tag>
      )}
    </>
  )
}
