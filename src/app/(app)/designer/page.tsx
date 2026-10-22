'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, ButtonGroup, Callout, Checkbox, HTMLSelect, Switch, Tag } from '@blueprintjs/core'
import { PageLayout } from '@/components/layout/PageLayout'
import { useTheme } from '@/lib/theme-provider'
import { ErDiagram, type DiagramSelection } from '@/components/designer/ErDiagram'
import { DesignerPanel } from '@/components/designer/DesignerPanel'
import { selectSubgraph } from '@/lib/designer/graph'
import { modelColor, type LayoutEngine } from '@/lib/designer/mermaid'
import type { DesignerGraph } from '@/lib/designer/types'

// ER diagram of all models, entities, attributes and references - generated
// from the metadata on every load, so it always matches the model.

// Beyond this many entities the layout gets slow (it blocks the page).
const LARGE_VIEW = 30

interface Filters {
  models: string[]
  foreign: boolean
  focusCode: string
  depth: number
  isolated: boolean
  layout: LayoutEngine
}

// Entities without any relationship are hidden by default: they only make the diagram tall and
// small. They are one switch away (and the count of hidden ones is shown).
const DEFAULT_FILTERS: Filters = { models: [], foreign: true, focusCode: '', depth: 1, isolated: false, layout: 'elk' }

export default function DesignerPage() {
  return (
    <Suspense>
      <DesignerPageInner />
    </Suspense>
  )
}

function DesignerPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const mode = theme === 'dark' ? 'dark' : 'light'

  const [graph, setGraph] = useState<DesignerGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<DiagramSelection>(null)
  // Filters live in the URL (shareable links); the initial values come from it.
  const [filters, setFilters] = useState<Filters>(() => ({
    models: (searchParams.get('model') ?? '').split(',').filter(Boolean),
    foreign: searchParams.get('foreign') !== '0',
    focusCode: searchParams.get('focus') ?? '',
    depth: Math.min(3, Math.max(0, Number(searchParams.get('depth') ?? 1) || 0)),
    isolated: searchParams.get('isolated') === '1',
    layout: searchParams.get('layout') === 'dagre' ? 'dagre' : 'elk',
  }))

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      const res = await fetch('/api/designer/graph')
      if (!res.ok) throw new Error('Das Modell konnte nicht geladen werden')
      setGraph(await res.json())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // keep the URL in sync with the filters
  useEffect(() => {
    const p = new URLSearchParams()
    if (filters.models.length) p.set('model', filters.models.join(','))
    if (!filters.foreign) p.set('foreign', '0')
    if (filters.focusCode) { p.set('focus', filters.focusCode); p.set('depth', String(filters.depth)) }
    if (filters.isolated) p.set('isolated', '1')
    if (filters.layout !== 'elk') p.set('layout', filters.layout)
    const qs = p.toString()
    router.replace(qs ? `/designer?${qs}` : '/designer', { scroll: false })
  }, [filters, router])

  const focusEntity = graph?.entities.find(e => e.code === filters.focusCode) ?? null

  const view = useMemo(() => {
    if (!graph) return null
    return selectSubgraph(graph, {
      modelCodes: filters.models,
      includeForeignNeighbours: filters.foreign,
      focusEntityId: focusEntity?.id ?? null,
      depth: filters.depth,
      showIsolated: filters.isolated,
    })
  }, [graph, filters, focusEntity])

  // how many entities the switch is hiding (same filters, isolated shown)
  const hiddenIsolated = useMemo(() => {
    if (!graph || !view || filters.isolated) return 0
    return selectSubgraph(graph, {
      modelCodes: filters.models, includeForeignNeighbours: filters.foreign,
      focusEntityId: focusEntity?.id ?? null, depth: filters.depth, showIsolated: true,
    }).entities.length - view.entities.length
  }, [graph, view, filters, focusEntity])

  // drop a selection that is no longer part of the view
  const visibleSelection: DiagramSelection = useMemo(() => {
    if (!selection || !view) return null
    const ids = new Set(view.entities.map(e => e.id))
    if (selection.type === 'reference') return view.references.some(r => r.id === selection.referenceId) ? selection : null
    return ids.has(selection.entityId) ? selection : null
  }, [selection, view])

  // Esc closes the details panel
  useEffect(() => {
    if (!selection) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelection(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }))
  const toggleModel = (code: string) =>
    set({ models: filters.models.includes(code) ? filters.models.filter(c => c !== code) : [...filters.models, code] })

  const focusOn = (entityId: number) => {
    const code = graph?.entities.find(e => e.id === entityId)?.code
    if (code) set({ focusCode: code, depth: Math.max(1, filters.depth) })
  }

  const entitiesByModel = useMemo(() => {
    const groups = new Map<string, DesignerGraph['entities']>()
    graph?.entities.forEach(e => groups.set(e.modelCode, [...(groups.get(e.modelCode) ?? []), e]))
    return [...groups.entries()]
  }, [graph])

  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setSelection(null) }
  const filtered = JSON.stringify({ ...filters, layout: 'elk' }) !== JSON.stringify(DEFAULT_FILTERS)

  if (!graph || !view) {
    return (
      <PageLayout
        title="Designer"
        breadcrumb={['Model Design', 'Designer']}
        loading={!loadError}
        loadingText="Modell wird geladen..."
        error={loadError}
        onRetry={load}
      />
    )
  }

  return (
    <PageLayout title="Designer" breadcrumb={['Model Design', 'Designer']}>
      {graph.warnings.length > 0 && (
        <Callout intent="warning" icon="warning-sign" title="Unstimmigkeiten in den Metadaten" style={{ marginBottom: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{graph.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </Callout>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: focusEntity ? 0.45 : 1 }} title={focusEntity ? 'Der Fokus hat Vorrang vor dem Model-Filter' : undefined}>
          <span style={{ fontSize: 12 }}>Model:</span>
          {graph.models.map(m => {
            const active = filters.models.includes(m.code)
            const c = modelColor(m.colorIndex, mode)
            return (
              <Tag
                key={m.id}
                interactive
                minimal={!active}
                onClick={() => toggleModel(m.code)}
                style={{ background: active ? c.fill : undefined, boxShadow: `inset 0 0 0 1px ${c.stroke}`, color: active ? (mode === 'dark' ? '#f6f7f9' : '#1c2127') : undefined }}
              >
                {m.code}
              </Tag>
            )
          })}
          {filters.models.length === 0 && <span style={{ fontSize: 11, opacity: 0.6 }}>alle</span>}
        </div>

        <span title="Auch Entities anderer Models zeigen, die mit den gewählten Models verknüpft sind">
          <Checkbox
            style={{ margin: 0 }}
            checked={filters.foreign}
            disabled={filters.models.length === 0 || !!focusEntity}
            onChange={e => set({ foreign: (e.target as HTMLInputElement).checked })}
            label="Verknüpfte Entities"
          />
        </span>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>Fokus:</span>
          <HTMLSelect value={filters.focusCode} onChange={e => set({ focusCode: e.target.value })}>
            <option value="">Alle Entities</option>
            {entitiesByModel.map(([model, list]) => (
              <optgroup key={model} label={model}>
                {list.map(e => <option key={e.id} value={e.code}>{e.name}</option>)}
              </optgroup>
            ))}
          </HTMLSelect>
          {focusEntity && (
            <>
              <span style={{ fontSize: 12 }}>Tiefe:</span>
              <HTMLSelect value={filters.depth} onChange={e => set({ depth: Number(e.target.value) })}>
                {[0, 1, 2, 3].map(d => <option key={d} value={d}>{d === 0 ? '0 (nur die Entity)' : `${d} Beziehungsschritt${d > 1 ? 'e' : ''}`}</option>)}
              </HTMLSelect>
            </>
          )}
        </div>

        <span title="Entities zeigen, die zu keiner anderen Entity eine Beziehung haben">
          <Switch
            style={{ margin: 0 }}
            checked={filters.isolated}
            onChange={e => set({ isolated: (e.target as HTMLInputElement).checked })}
            label="Ohne Beziehungen"
          />
        </span>

        <ButtonGroup>
          <Button small active={filters.layout === 'elk'} onClick={() => set({ layout: 'elk' })} title="Rechtwinklige Linien, ordentlich, etwas langsamer">ELK</Button>
          <Button small active={filters.layout === 'dagre'} onClick={() => set({ layout: 'dagre' })} title="Schneller, Linien geschwungen">Dagre</Button>
        </ButtonGroup>

        {filtered && <Button small minimal icon="reset" onClick={resetFilters}>Filter zurücksetzen</Button>}

        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
          {view.entities.length} von {graph.entities.length} Entities · {view.references.length} Beziehungen
          {hiddenIsolated > 0 && (
            <> · <a role="button" style={{ cursor: 'pointer' }} onClick={() => set({ isolated: true })}>{hiddenIsolated} ohne Beziehungen ausgeblendet – anzeigen</a></>
          )}
        </span>
      </div>

      {view.entities.length > LARGE_VIEW && filters.layout === 'elk' && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 10 }}>
          {view.entities.length} Entities auf einmal: die Berechnung kann mehrere Sekunden dauern. Mit Model-Filter, Fokus oder Dagre geht es schneller.
        </Callout>
      )}

      {view.entities.length === 0 ? (
        <Callout icon="info-sign">Mit diesen Filtern ist nichts zu sehen.</Callout>
      ) : (
        <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 230px)', minHeight: 420 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ErDiagram
              graph={view}
              layout={filters.layout}
              mode={mode}
              selection={visibleSelection}
              onSelect={setSelection}
              onOpenEntity={id => router.push(`/data?entity_id=${id}`)}
            />
          </div>
          {visibleSelection && (
            <DesignerPanel
              graph={view}
              selection={visibleSelection}
              mode={mode}
              onSelect={setSelection}
              onClose={() => setSelection(null)}
              onOpenData={id => router.push(`/data?entity_id=${id}`)}
              onOpenAttributes={id => router.push(`/attributes?entity_id=${id}`)}
              onFocus={focusOn}
            />
          )}
        </div>
      )}
    </PageLayout>
  )
}
