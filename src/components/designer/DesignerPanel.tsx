'use client'

import { Button, ButtonGroup, HTMLTable, Icon, Tag } from '@blueprintjs/core'
import type { DesignerAttribute, DesignerEntity, DesignerGraph, DesignerReference } from '@/lib/designer/types'
import { modelColor, type DiagramMode } from '@/lib/designer/mermaid'
import type { DiagramSelection } from './ErDiagram'

interface DesignerPanelProps {
  graph: DesignerGraph
  selection: NonNullable<DiagramSelection>
  mode: DiagramMode
  onSelect: (selection: DiagramSelection) => void
  onClose: () => void
  onOpenData: (entityId: number) => void
  onOpenAttributes: (entityId: number) => void
  onFocus: (entityId: number) => void
}

// Details of whatever is selected in the diagram, with the way on to the data.
export function DesignerPanel({ graph, selection, mode, onSelect, onClose, onOpenData, onOpenAttributes, onFocus }: DesignerPanelProps) {
  const entityById = new Map(graph.entities.map(e => [e.id, e]))
  const border = mode === 'dark' ? '#404854' : '#d3d8de'

  const modelTag = (e: DesignerEntity) => {
    const model = graph.models.find(m => m.id === e.modelId)
    const c = modelColor(model?.colorIndex ?? 0, mode)
    return <Tag minimal style={{ background: c.fill, color: mode === 'dark' ? '#f6f7f9' : '#1c2127', boxShadow: `inset 0 0 0 1px ${c.stroke}` }}>{e.modelCode}</Tag>
  }

  const entityLink = (id: number) => {
    const e = entityById.get(id)
    return e
      ? <a role="button" onClick={() => onSelect({ type: 'entity', entityId: id })} style={{ cursor: 'pointer' }}>{e.name}</a>
      : <span>#{id}</span>
  }

  const actions = (entityId: number) => (
    <ButtonGroup fill style={{ margin: '10px 0' }}>
      <Button icon="database" intent="primary" onClick={() => onOpenData(entityId)}>Daten</Button>
      <Button icon="column-layout" onClick={() => onOpenAttributes(entityId)}>Attribute</Button>
      <Button icon="filter" onClick={() => onFocus(entityId)} title="Nur diese Entity und ihre Beziehungen zeigen">Fokus</Button>
    </ButtonGroup>
  )

  const typeLabel = (a: DesignerAttribute) =>
    a.referenceEntityId !== null ? `→ ${entityById.get(a.referenceEntityId)?.name ?? `#${a.referenceEntityId}`}` : a.dataType

  let title = ''
  let body: React.ReactNode = null

  if (selection.type === 'entity' || selection.type === 'attribute') {
    const entity = entityById.get(selection.entityId)
    if (!entity) return null
    title = entity.name
    const incoming = graph.references.filter(r => r.toEntityId === entity.id && !r.selfReference)
    const selectedAttr = selection.type === 'attribute' ? entity.attributes.find(a => a.id === selection.attributeId) : null

    body = (
      <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {modelTag(entity)}
          <Tag minimal>{entity.scdType}</Tag>
          <Tag minimal>{entity.status}</Tag>
          <code style={{ fontSize: 11 }}>{entity.code}</code>
        </div>
        {actions(entity.id)}

        {selectedAttr && <AttributeDetail attribute={selectedAttr} entity={entity} entityLink={entityLink} />}

        <h4 style={{ margin: '12px 0 4px' }}>Attribute ({entity.attributes.length})</h4>
        {entity.attributes.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Diese Entity hat noch keine Attribute.</p>
        ) : (
          <HTMLTable compact interactive style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: 22 }} /><col /><col style={{ width: '42%' }} /></colgroup>
            <tbody>
              {entity.attributes.map(a => (
                <tr
                  key={a.id}
                  onClick={() => onSelect({ type: 'attribute', entityId: entity.id, attributeId: a.id })}
                  style={selection.type === 'attribute' && selection.attributeId === a.id ? { outline: '2px solid #4c90f0', outlineOffset: -2 } : undefined}
                >
                  <td style={{ width: 20 }}>{a.isBusinessKey && <Icon icon="key" size={12} title="Business Key" />}</td>
                  <td style={{ wordBreak: 'break-word' }}><code>{a.code}</code>{a.isRequired && !a.isBusinessKey && <span title="Pflichtfeld"> *</span>}</td>
                  <td style={{ opacity: 0.8, wordBreak: 'break-word' }}>{typeLabel(a)}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}

        {incoming.length > 0 && (
          <>
            <h4 style={{ margin: '12px 0 4px' }}>Referenziert von ({incoming.length})</h4>
            <HTMLTable compact interactive style={{ width: '100%', tableLayout: 'fixed' }}>
              <tbody>
                {incoming.map(r => (
                  <tr key={r.id} onClick={() => onSelect({ type: 'reference', referenceId: r.id })}>
                    <td style={{ wordBreak: 'break-word' }}>{entityById.get(r.fromEntityId)?.name}</td>
                    <td style={{ opacity: 0.8, wordBreak: 'break-word' }}><code>{r.fromAttributeCode}</code></td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </>
        )}
      </>
    )
  } else {
    const ref = graph.references.find(r => r.id === selection.referenceId)
    if (!ref) return null
    title = 'Beziehung'
    body = <ReferenceDetail reference={ref} graph={graph} entityLink={entityLink} onOpenData={onOpenData} onSelect={onSelect} />
  }

  return (
    <div style={{ width: 320, flex: '0 0 320px', border: `1px solid ${border}`, borderRadius: 3, padding: 12, overflow: 'auto', background: mode === 'dark' ? '#252a31' : '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        <Button icon="cross" minimal small onClick={onClose} title="Schließen" />
      </div>
      {body}
    </div>
  )
}

function AttributeDetail({ attribute: a, entity, entityLink }: {
  attribute: DesignerAttribute
  entity: DesignerEntity
  entityLink: (id: number) => React.ReactNode
}) {
  return (
    <div style={{ margin: '4px 0 8px', padding: 8, borderLeft: '3px solid #4c90f0' }}>
      <div><b>{a.name}</b> <code style={{ fontSize: 11 }}>{entity.code}.{a.code}</code></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        <Tag minimal>{a.dataType}</Tag>
        {a.isBusinessKey && <Tag minimal intent="warning" icon="key">Business Key</Tag>}
        {a.isRequired && <Tag minimal intent="danger">Pflicht</Tag>}
        {a.isUnique && <Tag minimal intent="primary">Unique</Tag>}
      </div>
      {a.referenceEntityId !== null && <div>Verweist auf: {entityLink(a.referenceEntityId)}</div>}
      {a.displayAttributeCode && <div style={{ opacity: 0.8 }}>Anzeige im Dropdown: <code>{a.displayAttributeCode}</code></div>}
      {a.cascadeParentCode && <div style={{ opacity: 0.8 }}>Abhängig von: <code>{a.cascadeParentCode}</code> (Kaskade)</div>}
    </div>
  )
}

function ReferenceDetail({ reference: r, graph, entityLink, onOpenData, onSelect }: {
  reference: DesignerReference
  graph: DesignerGraph
  entityLink: (id: number) => React.ReactNode
  onOpenData: (entityId: number) => void
  onSelect: (selection: DiagramSelection) => void
}) {
  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        {entityLink(r.fromEntityId)} <Icon icon="arrow-right" size={12} /> {entityLink(r.toEntityId)}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tag minimal>{r.required ? 'Pflicht (genau 1)' : 'optional (0..1)'}</Tag>
        {r.identifying && <Tag minimal intent="warning" icon="key">Teil des Business Keys</Tag>}
        {r.crossModel && <Tag minimal intent="primary">Model-übergreifend</Tag>}
        {r.selfReference && <Tag minimal>Selbstbezug</Tag>}
      </div>
      <div>Attribut: <a role="button" style={{ cursor: 'pointer' }} onClick={() => onSelect({ type: 'attribute', entityId: r.fromEntityId, attributeId: r.fromAttributeId })}><code>{r.fromAttributeCode}</code></a></div>
      {r.cascadeParentCode && <div style={{ opacity: 0.8 }}>Kaskade: abhängig von <code>{r.cascadeParentCode}</code></div>}
      <ButtonGroup fill vertical alignText="left" style={{ marginTop: 12 }}>
        <Button icon="database" onClick={() => onOpenData(r.fromEntityId)}>Daten: {graph.entities.find(e => e.id === r.fromEntityId)?.name ?? 'Quelle'}</Button>
        <Button icon="database" onClick={() => onOpenData(r.toEntityId)}>Daten: {graph.entities.find(e => e.id === r.toEntityId)?.name ?? 'Ziel'}</Button>
      </ButtonGroup>
    </>
  )
}
