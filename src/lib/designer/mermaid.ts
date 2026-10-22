import type { DesignerAttribute, DesignerEntity, DesignerGraph, DesignerReference } from './types'

// DesignerGraph -> Mermaid `erDiagram` text.
//
// Design notes (verified against Mermaid 12):
// - Entities are declared as e<id> with the readable name as alias, so there is
//   nothing to sanitise or collide, and a click on the rendered SVG maps back
//   to the entity by its id.
// - One relationship per reference attribute, in graph order: the SVG labels
//   its lines with that index, which maps a clicked line back to the reference.
// - Cardinality: the referenced side is "exactly one" for a required attribute
//   and "zero or one" for an optional one; the referencing side is always
//   "zero or more" (a parent may have no children). An attribute that is part
//   of the business key makes the line solid (identifying), otherwise dashed.
// - Rows appear in the entity block in attribute order, which maps a clicked
//   row back to the attribute.

export type DiagramMode = 'dark' | 'light'
export type LayoutEngine = 'elk' | 'dagre'

export interface MermaidOptions {
  layout?: LayoutEngine
  direction?: 'LR' | 'TB'
  mode?: DiagramMode
}

export interface MermaidDiagram {
  text: string
  /** Index = relationship number in the rendered SVG. */
  references: DesignerReference[]
}

// Model colours (fill / stroke). Fills are explicit because Mermaid applies
// classDef values verbatim, so each mode has its own palette.
const PALETTE: Record<DiagramMode, Array<{ fill: string; stroke: string }>> = {
  dark: [
    { fill: '#2b4a6f', stroke: '#4c90f0' },
    { fill: '#2f4a3a', stroke: '#3dcc91' },
    { fill: '#5c3d1e', stroke: '#ec9a3c' },
    { fill: '#4a2d5c', stroke: '#c274c2' },
    { fill: '#1d4d4f', stroke: '#2db4c4' },
    { fill: '#5c2a2a', stroke: '#e76a6e' },
    { fill: '#554a1c', stroke: '#d1b436' },
    { fill: '#3a3f48', stroke: '#8f99a8' },
  ],
  light: [
    { fill: '#d3e4fa', stroke: '#2d72d2' },
    { fill: '#d4f0e1', stroke: '#0f9960' },
    { fill: '#fbe4c8', stroke: '#d9822b' },
    { fill: '#ead6f0', stroke: '#9d3f9d' },
    { fill: '#cdeff2', stroke: '#00a3a3' },
    { fill: '#f9d6d7', stroke: '#cd4246' },
    { fill: '#f4eac4', stroke: '#bf9d00' },
    { fill: '#e1e8ed', stroke: '#738694' },
  ],
}

export function modelColor(colorIndex: number, mode: DiagramMode) {
  const colors = PALETTE[mode]
  return colors[colorIndex % colors.length]
}

export const entityKey = (entityId: number) => `e${entityId}`

// Text inside quotes: Mermaid treats `"` as the end of the string and
// `#name;` as an HTML entity.
export function mermaidLabel(text: string): string {
  return String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\\/g, '/')
    .replace(/#(\w+);/g, '$1')
    .trim()
}

// Attribute names must look like identifiers.
export function mermaidAttributeName(code: string): string {
  const cleaned = code.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

function attributeLine(a: DesignerAttribute): string {
  const keys = [
    a.isBusinessKey ? 'PK' : null,
    a.referenceEntityId !== null ? 'FK' : null,
    a.isUnique && !a.isBusinessKey ? 'UK' : null,
  ].filter(Boolean).join(', ')
  const type = a.dataType === 'reference' ? 'ref' : a.dataType.replace(/[^A-Za-z0-9_]/g, '_') || 'string'
  const comment = mermaidLabel(a.name) + (a.isRequired && !a.isBusinessKey ? ' *' : '')
  return `    ${type} ${mermaidAttributeName(a.code)}${keys ? ` ${keys}` : ''} "${comment}"`
}

function entityBlock(e: DesignerEntity): string[] {
  const head = `  ${entityKey(e.id)}["${mermaidLabel(e.name)} · ${mermaidLabel(e.modelCode)}"]:::m${e.modelId}`
  // An entity without attributes is a bare box (an empty `{}` block is a syntax error).
  if (e.attributes.length === 0) return [head]
  return [`${head} {`, ...e.attributes.map(attributeLine), '  }']
}

function relationshipLine(r: DesignerReference): string {
  const parentEnd = r.required ? '||' : 'o|'
  const line = r.identifying ? '--' : '..'
  return `  ${entityKey(r.fromEntityId)} }o${line}${parentEnd} ${entityKey(r.toEntityId)} : "${mermaidLabel(r.fromAttributeCode)}"`
}

export function toMermaid(graph: DesignerGraph, options: MermaidOptions = {}): MermaidDiagram {
  const { layout = 'elk', direction = 'LR', mode = 'dark' } = options
  const lines: string[] = []

  if (layout === 'elk') lines.push('---', 'config:', '  layout: elk', '---')
  lines.push('erDiagram', `  direction ${direction}`)

  const textColor = mode === 'dark' ? '#f6f7f9' : '#1c2127'
  for (const m of graph.models) {
    const c = modelColor(m.colorIndex, mode)
    lines.push(`  classDef m${m.id} fill:${c.fill},stroke:${c.stroke},color:${textColor}`)
  }

  for (const e of graph.entities) lines.push(...entityBlock(e))

  // Only references whose both ends are in the graph (selectSubgraph already
  // guarantees it; stay defensive because a dangling id would make Mermaid
  // invent an empty entity).
  const ids = new Set(graph.entities.map(e => e.id))
  const references = graph.references.filter(r => ids.has(r.fromEntityId) && ids.has(r.toEntityId))
  for (const r of references) lines.push(relationshipLine(r))

  return { text: lines.join('\n'), references }
}
