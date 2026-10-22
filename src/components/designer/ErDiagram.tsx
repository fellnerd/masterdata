'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ButtonGroup, Callout, Spinner } from '@blueprintjs/core'
import type { DesignerGraph, DesignerReference } from '@/lib/designer/types'
import { toMermaid, type DiagramMode, type LayoutEngine } from '@/lib/designer/mermaid'

// Renders a DesignerGraph as a Mermaid ER diagram and makes it navigable:
// pan / zoom, click on an entity, an attribute row or a relationship line,
// double click on an entity, selection highlighting.
//
// Mermaid has no click support for ER diagrams, so the interaction is attached
// to the rendered SVG. That relies on Mermaid's generated element ids
// (`<renderId>-entity-e<entityId>-<n>` for entities, `…_<index>` for
// relationship lines, `row-rect-odd|even` groups for attribute rows), which are
// not a public API - the Mermaid version is therefore pinned in package.json.

export type DiagramSelection =
  | { type: 'entity'; entityId: number }
  | { type: 'attribute'; entityId: number; attributeId: number }
  | { type: 'reference'; referenceId: number }
  | null

interface ErDiagramProps {
  graph: DesignerGraph
  layout: LayoutEngine
  mode: DiagramMode
  selection: DiagramSelection
  onSelect: (selection: DiagramSelection) => void
  onOpenEntity: (entityId: number) => void
}

const THEMES: Record<DiagramMode, Record<string, string | boolean>> = {
  dark: {
    darkMode: true,
    background: '#1c2127',
    primaryColor: '#2f343c',
    primaryTextColor: '#f6f7f9',
    primaryBorderColor: '#5f6b7c',
    lineColor: '#8f99a8',
    textColor: '#c5cbd3',
    tertiaryColor: '#252a31',
    attributeBackgroundColorOdd: '#252a31',
    attributeBackgroundColorEven: '#2f343c',
  },
  light: {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#ffffff',
    primaryTextColor: '#1c2127',
    primaryBorderColor: '#8f99a8',
    lineColor: '#5f6b7c',
    textColor: '#1c2127',
    tertiaryColor: '#f6f7f9',
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#f6f7f9',
  },
}

type MermaidApi = typeof import('mermaid').default
// Rendered SVGs by diagram text: switching back to a view seen before (theme, filter, layout
// toggles) is instant instead of another 1-2 s layout run.
const svgCache = new Map<string, string>()
const SVG_CACHE_SIZE = 12

let mermaidPromise: Promise<MermaidApi> | null = null
let initializedMode: DiagramMode | null = null

// Mermaid (and the ELK layout) are large: load them only when the Designer is opened.
async function getMermaid(mode: DiagramMode): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const [mermaidModule, elkModule] = await Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')])
      mermaidModule.default.registerLayoutLoaders(elkModule.default)
      return mermaidModule.default
    })()
  }
  const mermaid = await mermaidPromise
  if (initializedMode !== mode) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: { ...THEMES[mode], fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: '12px' },
      er: { useMaxWidth: false },
    })
    initializedMode = mode
  }
  return mermaid
}

interface DomIndex {
  nodes: Map<number, SVGGElement>
  edges: Map<number, SVGElement[]> // relationship index -> line, hit area, label
}

interface View { x: number; y: number; k: number }

const MIN_K = 0.05
const MAX_K = 2.5

export function ErDiagram({ graph, layout, mode, selection, onSelect, onOpenEntity }: ErDiagramProps) {
  const diagram = useMemo(() => toMermaid(graph, { layout, mode }), [graph, layout, mode])

  const viewportRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const displayed = useRef<{ references: DesignerReference[]; graph: DesignerGraph; dom: DomIndex; w: number; h: number } | null>(null)
  const renderSeq = useRef(0)
  const lastSelectionKey = useRef('')
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renderMs, setRenderMs] = useState<number | null>(null)
  // bumped after every successful render so the highlight effect re-applies
  const [renderVersion, setRenderVersion] = useState(0)

  const applyView = useCallback((next: View) => {
    viewRef.current = next
    setView(next)
  }, [])

  const fit = useCallback(() => {
    const vp = viewportRef.current
    const d = displayed.current
    if (!vp || !d) return
    const pad = 24
    const k = Math.min(Math.max(vp.clientWidth - pad * 2, 50) / d.w, Math.max(vp.clientHeight - pad * 2, 50) / d.h, 1)
    const kk = Math.max(MIN_K, k)
    applyView({ k: kk, x: (vp.clientWidth - d.w * kk) / 2, y: Math.max(pad, (vp.clientHeight - d.h * kk) / 2) })
  }, [applyView])

  // ---- render ---------------------------------------------------------------
  useEffect(() => {
    const seq = ++renderSeq.current
    setBusy(true)
    const timer = setTimeout(async () => {
      const renderId = `dd${seq}`
      try {
        const cacheKey = `${mode}|${diagram.text}`
        const t0 = performance.now()
        let svg = svgCache.get(cacheKey)
        if (svg === undefined) {
          const mermaid = await getMermaid(mode)
          // let the busy indicator paint before the (blocking) layout runs. A timeout, not
          // requestAnimationFrame: rAF never fires in a background tab, which would leave the
          // diagram waiting forever.
          await new Promise<void>(resolve => setTimeout(resolve, 50))
          if (seq !== renderSeq.current) return
          svg = (await mermaid.render(renderId, diagram.text)).svg
          if (seq !== renderSeq.current) return
          svgCache.set(cacheKey, svg)
          if (svgCache.size > SVG_CACHE_SIZE) svgCache.delete(svgCache.keys().next().value as string)
        }

        const host = hostRef.current
        if (!host) return
        host.innerHTML = svg
        const svgEl = host.querySelector('svg')
        if (!svgEl) throw new Error('Mermaid returned no SVG')

        const box = (svgEl.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
        const w = box[2] || svgEl.getBoundingClientRect().width
        const h = box[3] || svgEl.getBoundingClientRect().height
        svgEl.setAttribute('width', String(w))
        svgEl.setAttribute('height', String(h))
        svgEl.style.maxWidth = 'none'
        svgEl.style.display = 'block'

        displayed.current = { references: diagram.references, graph, dom: indexDom(svgEl, diagram.references), w, h }
        setRenderMs(Math.round(performance.now() - t0))
        setError(null)
        setRenderVersion(v => v + 1)
        fit()
      } catch (e) {
        if (seq !== renderSeq.current) return
        document.getElementById(`d${renderId}`)?.remove() // Mermaid leaves its scratch node behind on errors
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (seq === renderSeq.current) setBusy(false)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [diagram, graph, mode, fit])

  // ---- selection highlight --------------------------------------------------
  useEffect(() => {
    const d = displayed.current
    if (!d) return
    const { dom } = d

    const activeEntities = new Set<number>()
    const activeEdges = new Set<number>()
    let activeRow: { entityId: number; attributeId: number } | null = null

    if (selection) {
      d.references.forEach((r, i) => {
        if (selection.type === 'entity' && (r.fromEntityId === selection.entityId || r.toEntityId === selection.entityId)) {
          activeEdges.add(i); activeEntities.add(r.fromEntityId); activeEntities.add(r.toEntityId)
        }
        if (selection.type === 'attribute' && r.fromAttributeId === selection.attributeId) {
          activeEdges.add(i); activeEntities.add(r.fromEntityId); activeEntities.add(r.toEntityId)
        }
        if (selection.type === 'reference' && r.id === selection.referenceId) {
          activeEdges.add(i); activeEntities.add(r.fromEntityId); activeEntities.add(r.toEntityId)
        }
      })
      if (selection.type === 'entity' || selection.type === 'attribute') activeEntities.add(selection.entityId)
      if (selection.type === 'attribute') activeRow = { entityId: selection.entityId, attributeId: selection.attributeId }
    }

    const dimming = selection !== null
    dom.nodes.forEach((node, entityId) => {
      node.classList.toggle('dd-dim', dimming && !activeEntities.has(entityId))
      node.classList.toggle('dd-selected', selection?.type === 'entity' && selection.entityId === entityId)
      node.querySelectorAll('.dd-row-active').forEach(el => el.classList.remove('dd-row-active'))
    })
    dom.edges.forEach((els, index) => {
      els.forEach(el => {
        el.classList.toggle('dd-dim', dimming && !activeEdges.has(index))
        el.classList.toggle('dd-edge-active', dimming && activeEdges.has(index))
      })
    })
    if (activeRow) {
      const entity = d.graph.entities.find(e => e.id === activeRow!.entityId)
      const rowIndex = entity ? entity.attributes.findIndex(a => a.id === activeRow!.attributeId) : -1
      const row = dom.nodes.get(activeRow.entityId)?.querySelectorAll('g.row-rect-odd, g.row-rect-even')[rowIndex]
      row?.classList.add('dd-row-active')
    }

    // A new selection can reach into the part of the diagram that is off screen
    // (or behind the side panel): bring everything it highlights into view. Slightly
    // delayed so a double click (open the data) is not thrown off by the view moving
    // under the pointer after its first click.
    const key = selection ? JSON.stringify(selection) : ''
    const changed = key !== '' && key !== lastSelectionKey.current
    lastSelectionKey.current = key
    if (!changed) return
    const timer = setTimeout(() => {
      const vp = viewportRef.current
      const rects = [...activeEntities].map(id => dom.nodes.get(id)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r)
      if (vp && rects.length > 0) {
        const v = vp.getBoundingClientRect()
        const pad = 24
        let left = Math.min(...rects.map(r => r.left))
        let right = Math.max(...rects.map(r => r.right))
        let top = Math.min(...rects.map(r => r.top))
        let bottom = Math.max(...rects.map(r => r.bottom))
        const cur = viewRef.current
        // too big for the viewport: zoom out until it fits
        const scale = Math.min(1, (v.width - pad * 2) / Math.max(1, right - left), (v.height - pad * 2) / Math.max(1, bottom - top))
        let k = cur.k
        let x = cur.x
        let y = cur.y
        if (scale < 1) {
          k = Math.max(MIN_K, cur.k * scale)
          const ratio = k / cur.k
          // scale about the viewport's top-left corner, then shift
          const ox = v.left, oy = v.top
          left = ox + (left - ox) * ratio; right = ox + (right - ox) * ratio
          top = oy + (top - oy) * ratio; bottom = oy + (bottom - oy) * ratio
          x = cur.x * ratio; y = cur.y * ratio
        }
        let dx = 0
        let dy = 0
        if (left < v.left + pad) dx = v.left + pad - left
        else if (right > v.right - pad) dx = v.right - pad - right
        if (top < v.top + pad) dy = v.top + pad - top
        else if (bottom > v.bottom - pad) dy = v.bottom - pad - bottom
        if (k !== cur.k || dx !== 0 || dy !== 0) applyView({ k, x: x + dx, y: y + dy })
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [selection, renderVersion, applyView])

  // ---- pan / zoom -----------------------------------------------------------
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    // React registers wheel listeners as passive, so the page would scroll instead of zooming.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const cur = viewRef.current
      const k = Math.min(MAX_K, Math.max(MIN_K, cur.k * Math.exp(-e.deltaY * 0.0015)))
      applyView({ k, x: cx - (cx - cur.x) * (k / cur.k), y: cy - (cy - cur.y) * (k / cur.k) })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [applyView])

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current
    if (!vp) return
    const cx = vp.clientWidth / 2
    const cy = vp.clientHeight / 2
    const cur = viewRef.current
    const k = Math.min(MAX_K, Math.max(MIN_K, cur.k * factor))
    applyView({ k, x: cx - (cx - cur.x) * (k / cur.k), y: cy - (cy - cur.y) * (k / cur.k) })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { startX: e.clientX, startY: e.clientY, originX: viewRef.current.x, originY: viewRef.current.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true
      viewportRef.current?.setPointerCapture(e.pointerId)
    }
    if (d.moved) applyView({ ...viewRef.current, x: d.originX + dx, y: d.originY + dy })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.moved) viewportRef.current?.releasePointerCapture(e.pointerId)
  }

  // ---- click mapping --------------------------------------------------------
  const hitTest = (target: EventTarget | null, clientY: number): DiagramSelection => {
    const d = displayed.current
    if (!d || !(target instanceof Element)) return null

    const hit = target.closest('[data-dd-edge]')
    if (hit) {
      const ref = d.references[Number(hit.getAttribute('data-dd-edge'))]
      return ref ? { type: 'reference', referenceId: ref.id } : null
    }

    const node = target.closest('g.node')
    const entityId = node ? entityIdOf(node) : null
    if (!node || entityId === null) return null

    // attribute rows are separate groups in document order = attribute order
    const rows = [...node.querySelectorAll('g.row-rect-odd, g.row-rect-even')]
    const rowIndex = rows.findIndex(row => {
      const r = row.getBoundingClientRect()
      return clientY >= r.top && clientY <= r.bottom
    })
    const attribute = rowIndex >= 0 ? d.graph.entities.find(en => en.id === entityId)?.attributes[rowIndex] : undefined
    return attribute
      ? { type: 'attribute', entityId, attributeId: attribute.id }
      : { type: 'entity', entityId }
  }

  const onClick = (e: React.MouseEvent) => {
    if (drag.current?.moved) { drag.current = null; return } // that was a pan, not a click
    drag.current = null
    onSelect(hitTest(e.target, e.clientY))
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = hitTest(e.target, e.clientY)
    if (hit && (hit.type === 'entity' || hit.type === 'attribute')) onOpenEntity(hit.entityId)
  }

  const surface = mode === 'dark' ? '#1c2127' : '#ffffff'
  const border = mode === 'dark' ? '#404854' : '#d3d8de'

  return (
    <div
      ref={viewportRef}
      className="dd-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ position: 'relative', overflow: 'hidden', background: surface, border: `1px solid ${border}`, borderRadius: 3, height: '100%', minHeight: 420, cursor: 'grab', touchAction: 'none' }}
    >
      <style>{DIAGRAM_CSS}</style>

      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, opacity: busy ? 0.45 : 1, transition: 'opacity 120ms' }}>
        {/* managed by hand (innerHTML), React never renders children here */}
        <div ref={hostRef} className="dd-stage" />
      </div>

      <div style={{ position: 'absolute', right: 8, top: 8 }} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <ButtonGroup vertical>
          <Button icon="plus" small onClick={() => zoomBy(1.25)} title="Vergrößern" />
          <Button icon="minus" small onClick={() => zoomBy(0.8)} title="Verkleinern" />
          <Button icon="zoom-to-fit" small onClick={fit} title="Alles einpassen" />
        </ButtonGroup>
      </div>

      <div style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 11, opacity: 0.7 }} onClick={e => e.stopPropagation()}>
        {Math.round(view.k * 100)} %{renderMs !== null && ` · berechnet in ${renderMs} ms`}
      </div>

      {busy && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 12, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 3, background: mode === 'dark' ? '#252a31' : '#f6f7f9', border: `1px solid ${border}`, fontSize: 12 }}>
            <Spinner size={14} /> Diagramm wird berechnet …
          </div>
        </div>
      )}

      {error && (
        <div style={{ position: 'absolute', left: 12, right: 12, top: 12 }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <Callout intent="danger" title="Diagramm konnte nicht erzeugt werden">
            <p style={{ marginBottom: 6 }}>{error}</p>
            <details>
              <summary>Mermaid-Quelltext</summary>
              <pre style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{diagram.text}</pre>
            </details>
          </Callout>
        </div>
      )}
    </div>
  )
}

function entityIdOf(node: Element): number | null {
  const match = node.id.match(/-entity-e(\d+)-\d+$/)
  return match ? Number(match[1]) : null
}

// Maps the rendered SVG back to the graph and widens the thin relationship
// lines with an invisible hit area so they are easy to click.
function indexDom(svg: SVGSVGElement, references: DesignerReference[]): DomIndex {
  const nodes = new Map<number, SVGGElement>()
  svg.querySelectorAll<SVGGElement>('g.node').forEach(node => {
    const id = entityIdOf(node)
    if (id !== null) nodes.set(id, node)
  })

  const edges = new Map<number, SVGElement[]>()
  svg.querySelectorAll<SVGPathElement>('path.relationshipLine').forEach(path => {
    const m = path.id.match(/_(\d+)$/)
    if (!m) return
    const index = Number(m[1])
    if (index >= references.length) return
    const hit = path.cloneNode(false) as SVGPathElement
    hit.removeAttribute('id')
    hit.removeAttribute('marker-start')
    hit.removeAttribute('marker-end')
    hit.setAttribute('class', 'dd-hit')
    hit.setAttribute('data-dd-edge', String(index))
    hit.setAttribute('fill', 'none')
    hit.setAttribute('stroke', 'transparent')
    hit.setAttribute('stroke-width', '14')
    hit.style.pointerEvents = 'stroke'
    hit.style.cursor = 'pointer'
    path.after(hit)
    edges.set(index, [path, hit])
  })

  // The labels are rendered in relationship order as well.
  const labels = [...svg.querySelectorAll<SVGElement>('g.edgeLabel, .edgeLabels > g')]
  labels.forEach((label, index) => {
    if (index >= references.length) return
    edges.get(index)?.push(label)
    // the label sits on the line, so it has to be clickable as well
    label.setAttribute('data-dd-edge', String(index))
    label.style.cursor = 'pointer'
  })

  return { nodes, edges }
}

const DIAGRAM_CSS = `
.dd-stage g.node { cursor: pointer; }
.dd-stage g.node.dd-selected .outer-path path { stroke: #4c90f0 !important; stroke-width: 3px !important; }
.dd-stage .dd-dim { opacity: 0.18; }
.dd-stage .dd-edge-active { stroke: #4c90f0 !important; stroke-width: 3px !important; }
.dd-stage g.edgeLabel.dd-edge-active, .dd-stage .edgeLabels .dd-edge-active { stroke: none !important; }
.dd-stage g.row-rect-odd.dd-row-active path, .dd-stage g.row-rect-even.dd-row-active path { fill: rgba(76, 144, 240, 0.55) !important; }
.dd-stage .dd-hit { opacity: 1 !important; }
`
