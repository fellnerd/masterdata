'use client';

import {
  Card,
  HTMLTable,
  Tag,
  Button,
  ButtonGroup,
  InputGroup,
  HTMLSelect,
  NonIdealState,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  Checkbox,
  Tooltip,
  Callout,
  Spinner,
  Icon,
  type IconName,
} from '@blueprintjs/core';
import { Suspense, useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useFilterPersistence } from '@/hooks/useFilterPersistence';

interface Attribute {
  id: number;
  entity_id: number;
  entity_code: string;
  entity_name: string;
  model_code: string;
  code: string;
  name: string;
  description: string | null;
  data_type: string;
  sql_type: string | null;
  max_length: number | null;
  precision: number | null;
  scale: number | null;
  is_required: boolean;
  is_business_key: boolean;
  is_unique: boolean;
  default_value: string | null;
  reference_entity_id: number | null;
  reference_entity_code: string | null;
  reference_display_attribute: string | null;
  cascade_parent_attribute: string | null;
  cascade_filter_attribute: string | null;
  validation_regex: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface Entity {
  id: number;
  code: string;
  name: string;
  model_code: string;
}

interface Summary {
  total: number;
  businessKeys: number;
  references: number;
  entities: number;
}

interface ReferenceSettings {
  display_attribute: string;   // '' = business key (what is stored)
  cascade_parent: string;      // '' = no cascade
  cascade_filter: string;
}

const NO_REFERENCE_SETTINGS: ReferenceSettings = {
  display_attribute: '',
  cascade_parent: '',
  cascade_filter: '',
};

// Settings of a reference attribute beyond "which entity": what is stored,
// what the dropdown shows, and whether the list narrows to a parent selection
// (Hauptgruppe -> Untergruppe). Shared by the Add and Edit dialogs.
function ReferenceSettingsFields({
  ownEntityId,
  ownCode,
  referencedEntityId,
  attributes,
  value,
  onChange,
}: {
  ownEntityId: number;
  ownCode: string;
  referencedEntityId: number;
  attributes: Attribute[];
  value: ReferenceSettings;
  onChange: (next: ReferenceSettings) => void;
}) {
  const refAttrs = attributes.filter((a) => a.entity_id === referencedEntityId);
  const ownAttrs = attributes.filter((a) => a.entity_id === ownEntityId && a.code !== ownCode);
  if (!referencedEntityId || refAttrs.length === 0) return null;

  const label = (a: Attribute) => `${a.name} (${a.code})`;

  const pickParent = (code: string) => {
    let filter = value.cascade_filter;
    if (!code) {
      filter = '';
    } else if (!filter) {
      // Natural default: the referenced entity's own link to the same entity
      // the parent points at (Untergruppe.epd_level_1 -> Hauptgruppe).
      const parent = ownAttrs.find((a) => a.code === code);
      const match = parent?.reference_entity_id
        ? refAttrs.filter((a) => a.data_type === 'reference' && a.reference_entity_id === parent.reference_entity_id)
        : [];
      if (match.length === 1) filter = match[0].code;
    }
    onChange({ ...value, cascade_parent: code, cascade_filter: filter });
  };

  return (
    <div style={{ borderLeft: '3px solid var(--blue3)', paddingLeft: 12, marginBottom: 12 }}>
      <FormGroup
        label="Anzeige im Dropdown"
        labelFor="ref-display-attr"
        helperText="Welches Feld der referenzierten Entity in der Auswahlliste angezeigt wird. Gespeichert wird immer der Business Key."
      >
        <HTMLSelect
          id="ref-display-attr"
          fill
          value={value.display_attribute}
          onChange={(e) => onChange({ ...value, display_attribute: e.target.value })}
        >
          <option value="">Business Key (Standard)</option>
          {refAttrs.map((a) => (
            <option key={a.code} value={a.code}>{label(a)}</option>
          ))}
        </HTMLSelect>
      </FormGroup>
      <FormGroup
        label="Abhängig von (Kaskade)"
        labelFor="ref-cascade-parent"
        helperText="Zeigt nur Einträge, die zur Auswahl in diesem anderen Feld passen (z. B. nur die Untergruppen der gewählten Hauptgruppe)."
      >
        <HTMLSelect
          id="ref-cascade-parent"
          fill
          value={value.cascade_parent}
          onChange={(e) => pickParent(e.target.value)}
        >
          <option value="">Keine</option>
          {ownAttrs.map((a) => (
            <option key={a.code} value={a.code}>{label(a)}</option>
          ))}
        </HTMLSelect>
      </FormGroup>
      {value.cascade_parent && (
        <FormGroup
          label="Vergleichsfeld in der referenzierten Entity"
          labelFor="ref-cascade-filter"
          helperText="Dieses Feld muss dem gewählten Wert des übergeordneten Feldes entsprechen."
        >
          <HTMLSelect
            id="ref-cascade-filter"
            fill
            value={value.cascade_filter}
            onChange={(e) => onChange({ ...value, cascade_filter: e.target.value })}
          >
            <option value="">Feld wählen...</option>
            {refAttrs.map((a) => (
              <option key={a.code} value={a.code}>{label(a)}</option>
            ))}
          </HTMLSelect>
        </FormGroup>
      )}
    </div>
  );
}

export default function AttributesPage() {
  return (
    <Suspense>
      <AttributesPageInner />
    </Suspense>
  );
}

function AttributesPageInner() {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, businessKeys: 0, references: 0, entities: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 'all' or a numeric entity id (as string) - was previously matched
  // against attr.entity_name, which meant an entity with zero attributes
  // (so it never appears in `attributes`) could never be selected here
  // even via a direct link (?entity_id=...).
  const [entityFilter, setEntityFilter] = useFilterPersistence('entity_id', 'mds_filter_attributes_entity', 'all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedAttribute, setSelectedAttribute] = useState<Attribute | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editAttribute, setEditAttribute] = useState<{
    name: string;
    description: string;
    is_required: boolean;
    is_unique: boolean;
    is_business_key: boolean;
    max_length: string;
    reference: ReferenceSettings;
  }>({
    name: '',
    description: '',
    is_required: false,
    is_unique: false,
    is_business_key: false,
    max_length: '',
    reference: NO_REFERENCE_SETTINGS,
  });
  const [newAttribute, setNewAttribute] = useState<{
    code: string;
    name: string;
    entity_id: number;
    data_type: string;
    max_length: string;
    is_required: boolean;
    is_unique: boolean;
    is_business_key: boolean;
    description: string;
    reference_entity_id?: number;
    reference: ReferenceSettings;
  }>({
    code: '',
    name: '',
    entity_id: 0,
    data_type: 'string',
    max_length: '',
    is_required: false,
    is_unique: false,
    is_business_key: false,
    description: '',
    reference_entity_id: 0,
    reference: NO_REFERENCE_SETTINGS,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [attrsRes, entitiesRes] = await Promise.all([
        fetch('/api/attributes'),
        fetch('/api/entities')
      ]);
      
      if (!attrsRes.ok || !entitiesRes.ok) {
        throw new Error('Failed to load data');
      }
      
      const attrsJson = await attrsRes.json();
      const entitiesJson = await entitiesRes.json();
      
      setAttributes(attrsJson.data || []);
      setSummary(attrsJson.summary || { total: 0, businessKeys: 0, references: 0, entities: 0 });
      setEntities(entitiesJson.data || []);
      
      if (entitiesJson.data?.length > 0 && newAttribute.entity_id === 0) {
        setNewAttribute(prev => ({ ...prev, entity_id: entitiesJson.data[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attributes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Re-reads the attribute list without the full-page loading state (used
  // after reordering, where the table should just change in place).
  const refreshAttributes = async () => {
    const res = await fetch('/api/attributes');
    if (!res.ok) return;
    const json = await res.json();
    setAttributes(json.data || []);
    setSummary(json.summary || { total: 0, businessKeys: 0, references: 0, entities: 0 });
  };

  const [movingId, setMovingId] = useState<number | null>(null);

  // Moves one attribute a step up/down within its entity. `attributes` comes
  // back from the API already in form order (sort_order, then id), so the
  // neighbour is simply the adjacent row of the same entity.
  const handleMove = async (attr: Attribute, direction: -1 | 1) => {
    const ordered = attributes.filter((a) => a.entity_id === attr.entity_id);
    const from = ordered.findIndex((a) => a.id === attr.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;

    const ids = ordered.map((a) => a.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];

    try {
      setMovingId(attr.id);
      const res = await fetch('/api/attributes/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: attr.entity_id, order: ids }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reorder attributes');
      }
      await refreshAttributes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reorder attributes');
    } finally {
      setMovingId(null);
    }
  };

  const getTypeIcon = (dataType: string): IconName => {
    switch (dataType) {
      case 'string':
        return 'font';
      case 'number':
      case 'integer':
      case 'decimal':
        return 'numerical';
      case 'date':
      case 'datetime':
        return 'calendar';
      case 'boolean':
        return 'segmented-control';
      case 'reference':
        return 'link';
      default:
        return 'help';
    }
  };

  const getTypeColor = (dataType: string) => {
    switch (dataType) {
      case 'string':
        return 'blue';
      case 'integer':
      case 'decimal':
        return 'green';
      case 'date':
      case 'datetime':
        return 'orange';
      case 'boolean':
        return 'purple';
      case 'reference':
        return 'teal';
      default:
        return 'gray';
    }
  };

  const filteredAttributes = attributes.filter((attr) => {
    const matchesSearch =
      attr.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      attr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      attr.entity_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesEntity = entityFilter === 'all' || attr.entity_id === Number(entityFilter);
    const matchesType = typeFilter === 'all' || attr.data_type === typeFilter;
    return matchesSearch && matchesEntity && matchesType;
  });

  const dataTypes = [...new Set(attributes.map((a) => a.data_type))];

  // Order is per entity and is changed on the entity's full list: with a
  // search/type filter active the visible neighbours aren't the real ones.
  const showOrderColumn = entityFilter !== 'all';
  const reorderEnabled = showOrderColumn && !searchQuery && typeFilter === 'all';
  const positionById = new Map<number, number>();
  if (showOrderColumn) {
    attributes
      .filter((a) => a.entity_id === Number(entityFilter))
      .forEach((a, i) => positionById.set(a.id, i));
  }
  const lastPosition = positionById.size - 1;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE');
  };

  const handleAddAttribute = async () => {
    try {
      setIsCreating(true);
      const res = await fetch('/api/attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_id: newAttribute.entity_id,
          code: newAttribute.code.toLowerCase().replace(/\s+/g, '_'),
          name: newAttribute.name,
          data_type: newAttribute.data_type,
          max_length: newAttribute.max_length ? parseInt(newAttribute.max_length) : null,
          is_required: newAttribute.is_required,
          is_unique: newAttribute.is_unique,
          is_business_key: newAttribute.is_business_key,
          description: newAttribute.description || null,
          reference_entity_id: newAttribute.data_type === 'reference' ? newAttribute.reference_entity_id : null,
          ...(newAttribute.data_type === 'reference' && {
            reference_display_attribute: newAttribute.reference.display_attribute || null,
            cascade_parent_attribute: newAttribute.reference.cascade_parent || null,
            cascade_filter_attribute: newAttribute.reference.cascade_parent ? newAttribute.reference.cascade_filter || null : null,
          }),
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create attribute');
      }
      
      setShowAddDialog(false);
      setNewAttribute({
        code: '',
        name: '',
        entity_id: entities[0]?.id || 0,
        data_type: 'string',
        max_length: '',
        is_required: false,
        is_unique: false,
        is_business_key: false,
        description: '',
        reference: NO_REFERENCE_SETTINGS,
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create attribute');
    } finally {
      setIsCreating(false);
    }
  };

  // Open edit dialog with selected attribute
  const handleOpenEdit = (attr: Attribute) => {
    setSelectedAttribute(attr);
    setEditAttribute({
      name: attr.name,
      description: attr.description || '',
      is_required: attr.is_required,
      is_unique: attr.is_unique,
      is_business_key: attr.is_business_key,
      max_length: attr.max_length?.toString() || '',
      reference: {
        display_attribute: attr.reference_display_attribute || '',
        cascade_parent: attr.cascade_parent_attribute || '',
        cascade_filter: attr.cascade_filter_attribute || '',
      },
    });
    setShowEditDialog(true);
  };

  // Update attribute
  const handleUpdateAttribute = async () => {
    if (!selectedAttribute) return;
    
    try {
      setIsUpdating(true);
      const res = await fetch(`/api/attributes/${selectedAttribute.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editAttribute.name,
          description: editAttribute.description || null,
          is_required: editAttribute.is_required,
          is_unique: editAttribute.is_unique,
          is_business_key: editAttribute.is_business_key,
          max_length: editAttribute.max_length ? parseInt(editAttribute.max_length) : null,
          ...(selectedAttribute.data_type === 'reference' && {
            reference_display_attribute: editAttribute.reference.display_attribute || null,
            cascade_parent_attribute: editAttribute.reference.cascade_parent || null,
            cascade_filter_attribute: editAttribute.reference.cascade_parent ? editAttribute.reference.cascade_filter || null : null,
          }),
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update attribute');
      }
      
      setShowEditDialog(false);
      setSelectedAttribute(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update attribute');
    } finally {
      setIsUpdating(false);
    }
  };

  // Open delete confirmation
  const handleOpenDelete = (attr: Attribute) => {
    setSelectedAttribute(attr);
    setShowDeleteDialog(true);
  };

  // Delete attribute
  const handleDeleteAttribute = async () => {
    if (!selectedAttribute) return;
    
    try {
      setIsDeleting(true);
      const res = await fetch(`/api/attributes/${selectedAttribute.id}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete attribute');
      }
      
      setShowDeleteDialog(false);
      setSelectedAttribute(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete attribute');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <PageLayout 
        title="Attributes" 
        breadcrumb={['Model Design', 'Attributes']}
        loading={true}
        loadingText="Loading attributes..."
      />
    );
  }

  if (error) {
    return (
      <PageLayout 
        title="Attributes" 
        breadcrumb={['Model Design', 'Attributes']}
        error={error}
        onRetry={fetchData}
      />
    );
  }

  return (
    <PageLayout title="Attributes" breadcrumb={['Model Design', 'Attributes']}>
      <KpiGrid>
        <KpiCard label="Attributes" value={summary.total} />
        <KpiCard label="Business Keys" value={summary.businessKeys} />
        <KpiCard label="References" value={summary.references} />
        <KpiCard label="Entities" value={summary.entities} />
      </KpiGrid>

      <SectionHeader 
        title="Attribute Definitions"
        actions={
          <>
            <InputGroup
              leftIcon="search"
              placeholder="Search attributes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 200 }}
            />
            <HTMLSelect
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              <option value="all">All Entities</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name} ({entity.model_code})
                </option>
              ))}
            </HTMLSelect>
            <HTMLSelect
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              {dataTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </HTMLSelect>
            <Button
              icon="add"
              intent="primary"
              onClick={() => {
                // Pre-select whichever entity is currently filtered, so the
                // dialog doesn't force re-picking what's already on screen.
                if (entityFilter !== 'all') {
                  setNewAttribute((prev) => ({ ...prev, entity_id: Number(entityFilter) }));
                }
                setShowAddDialog(true);
              }}
            >
              Add Attribute
            </Button>
          </>
        }
      />

      {filteredAttributes.length > 0 ? (
        <div className="data-table-container">
            <HTMLTable striped interactive style={{ width: '100%' }}>
              <thead>
                <tr>
                  {showOrderColumn && <th>Order</th>}
                  <th>Name</th>
                  <th>Display Name</th>
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Constraints</th>
                  <th>Reference</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttributes.map((attr) => (
                  <tr key={attr.id}>
                    {showOrderColumn && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <ButtonGroup minimal>
                          <Tooltip content={reorderEnabled ? 'Move up' : 'Clear search and type filter to reorder'}>
                            <Button
                              icon="arrow-up"
                              small
                              disabled={!reorderEnabled || movingId !== null || positionById.get(attr.id) === 0}
                              onClick={() => handleMove(attr, -1)}
                            />
                          </Tooltip>
                          <Tooltip content={reorderEnabled ? 'Move down' : 'Clear search and type filter to reorder'}>
                            <Button
                              icon="arrow-down"
                              small
                              disabled={!reorderEnabled || movingId !== null || positionById.get(attr.id) === lastPosition}
                              onClick={() => handleMove(attr, 1)}
                            />
                          </Tooltip>
                        </ButtonGroup>
                        <span className="text-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                          {(positionById.get(attr.id) ?? 0) + 1}
                        </span>
                      </td>
                    )}
                    <td>
                      <code>{attr.code}</code>
                    </td>
                    <td>{attr.name}</td>
                    <td>
                      <Tag minimal>{attr.entity_name}</Tag>
                    </td>
                    <td>
                      <Tag
                        icon={getTypeIcon(attr.data_type)}
                        minimal
                        style={{
                          backgroundColor: `var(--${getTypeColor(attr.data_type)}1)`,
                          color: `var(--${getTypeColor(attr.data_type)}5)`,
                        }}
                      >
                        {attr.data_type}
                        {attr.max_length && ` (${attr.max_length})`}
                      </Tag>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {attr.is_business_key && (
                          <Tooltip content="Business Key - used for hash generation">
                            <Tag intent="warning" icon="key" minimal>
                              BK
                            </Tag>
                          </Tooltip>
                        )}
                        {attr.is_required && (
                          <Tooltip content="Required field">
                            <Tag intent="danger" minimal>
                              REQ
                            </Tag>
                          </Tooltip>
                        )}
                        {attr.is_unique && (
                          <Tooltip content="Unique constraint">
                            <Tag intent="primary" minimal>
                              UQ
                            </Tag>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    <td>
                      {attr.reference_entity_code ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          <Tag icon="link" minimal interactive>
                            {attr.reference_entity_code}
                          </Tag>
                          {attr.reference_display_attribute && (
                            <Tooltip content="Angezeigtes Feld im Dropdown">
                              <Tag minimal>Anzeige: {attr.reference_display_attribute}</Tag>
                            </Tooltip>
                          )}
                          {attr.cascade_parent_attribute && (
                            <Tooltip content={`Zeigt nur Einträge, deren ${attr.cascade_filter_attribute} zum gewählten ${attr.cascade_parent_attribute} passt`}>
                              <Tag icon="flow-end" intent="primary" minimal>abhängig von {attr.cascade_parent_attribute}</Tag>
                            </Tooltip>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{formatDate(attr.updated_at)}</td>
                    <td>
                      <ButtonGroup minimal>
                        <Tooltip content="Edit attribute">
                          <Button icon="edit" small onClick={() => handleOpenEdit(attr)} />
                        </Tooltip>
                        <Tooltip content="View usage">
                          <Button icon="search-around" small onClick={() => alert(`Attribute "${attr.name}" wird in Entity "${attr.entity_name}" verwendet.`)} />
                        </Tooltip>
                        <Tooltip content="Delete">
                          <Button icon="trash" small intent="danger" onClick={() => handleOpenDelete(attr)} />
                        </Tooltip>
                      </ButtonGroup>
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        ) : (
          <NonIdealState
            icon="search"
            title="No attributes found"
            description="No attributes match your current filters."
          />
        )}

      {/* Add Attribute Dialog */}
      <Dialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        title="Add Attribute"
        icon="add"
      >
        <DialogBody>
          <FormGroup label="Attribute Code" labelFor="attr-code" labelInfo="(required)" helperText="Technical name (e.g., customer_name)">
            <InputGroup
              id="attr-code"
              placeholder="e.g. customer_name"
              value={newAttribute.code}
              onChange={(e) =>
                setNewAttribute({ ...newAttribute, code: e.target.value.toLowerCase() })
              }
            />
          </FormGroup>
          <FormGroup label="Display Name" labelFor="attr-name" labelInfo="(required)">
            <InputGroup
              id="attr-name"
                placeholder="e.g. Customer Name"
                value={newAttribute.name}
                onChange={(e) =>
                  setNewAttribute({ ...newAttribute, name: e.target.value })
                }
              />
            </FormGroup>
            <FormGroup label="Entity" labelFor="attr-entity" labelInfo="(required)">
              <HTMLSelect
                id="attr-entity"
                value={newAttribute.entity_id}
                onChange={(e) =>
                  setNewAttribute({ ...newAttribute, entity_id: Number(e.target.value) })
                }
                fill
              >
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name} ({entity.model_code})
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>
            <FormGroup label="Data Type" labelFor="attr-type">
              <HTMLSelect
                id="attr-type"
                value={newAttribute.data_type}
                onChange={(e) =>
                  setNewAttribute({ ...newAttribute, data_type: e.target.value })
                }
                fill
              >
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="decimal">Decimal</option>
                <option value="date">Date</option>
                <option value="datetime">DateTime</option>
                <option value="boolean">Boolean</option>
                <option value="reference">Reference</option>
              </HTMLSelect>
            </FormGroup>
            {newAttribute.data_type === 'reference' && (
              <FormGroup label="Referenced Entity" labelFor="attr-ref" labelInfo="(required)">
                <HTMLSelect
                  id="attr-ref"
                  value={newAttribute.reference_entity_id}
                  onChange={(e) =>
                    setNewAttribute({ ...newAttribute, reference_entity_id: Number(e.target.value), reference: NO_REFERENCE_SETTINGS })
                  }
                  fill
                >
                  <option value={0}>Select entity...</option>
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name} ({entity.model_code})
                    </option>
                  ))}
                </HTMLSelect>
              </FormGroup>
            )}
            {newAttribute.data_type === 'reference' && !!newAttribute.reference_entity_id && (
              <ReferenceSettingsFields
                ownEntityId={newAttribute.entity_id}
                ownCode=""
                referencedEntityId={newAttribute.reference_entity_id}
                attributes={attributes}
                value={newAttribute.reference}
                onChange={(reference) => setNewAttribute({ ...newAttribute, reference })}
              />
            )}
            {newAttribute.data_type === 'string' && (
              <FormGroup label="Max Length" labelFor="attr-length">
                <InputGroup
                  id="attr-length"
                  type="number"
                  placeholder="e.g. 255"
                  value={newAttribute.max_length}
                  onChange={(e) =>
                    setNewAttribute({ ...newAttribute, max_length: e.target.value })
                  }
                />
              </FormGroup>
            )}
            <FormGroup label="Description" labelFor="attr-desc">
              <InputGroup
                id="attr-desc"
                placeholder="Describe this attribute..."
                value={newAttribute.description}
                onChange={(e) =>
                  setNewAttribute({ ...newAttribute, description: e.target.value })
                }
              />
            </FormGroup>
            <div style={{ display: 'flex', gap: 16 }}>
              <Checkbox
                checked={newAttribute.is_required}
                onChange={(e) =>
                  setNewAttribute({
                    ...newAttribute,
                    is_required: (e.target as HTMLInputElement).checked,
                  })
                }
              >
                Required
              </Checkbox>
              <Checkbox
                checked={newAttribute.is_unique}
                onChange={(e) =>
                  setNewAttribute({
                    ...newAttribute,
                    is_unique: (e.target as HTMLInputElement).checked,
                  })
                }
              >
                Unique
              </Checkbox>
              <Checkbox
                checked={newAttribute.is_business_key}
                onChange={(e) =>
                  setNewAttribute({
                    ...newAttribute,
                    is_business_key: (e.target as HTMLInputElement).checked,
                  })
                }
              >
                Business Key
              </Checkbox>
            </div>
          </DialogBody>
          <DialogFooter
            actions={
              <>
                <Button text="Cancel" onClick={() => setShowAddDialog(false)} disabled={isCreating} />
                <Button
                  intent="primary"
                  icon="add"
                  text="Add Attribute"
                  onClick={handleAddAttribute}
                  disabled={!newAttribute.code || !newAttribute.name || !newAttribute.entity_id || isCreating}
                  loading={isCreating}
                />
              </>
            }
          />
        </Dialog>

      {/* Edit Attribute Dialog */}
      <Dialog
        isOpen={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        title={`Edit: ${selectedAttribute?.name || ''}`}
        icon="edit"
      >
        <DialogBody>
          <FormGroup label="Display Name" labelFor="edit-name" labelInfo="(required)">
            <InputGroup
              id="edit-name"
              value={editAttribute.name}
              onChange={(e) => setEditAttribute({ ...editAttribute, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Description" labelFor="edit-desc">
            <InputGroup
              id="edit-desc"
              placeholder="Describe this attribute..."
              value={editAttribute.description}
              onChange={(e) => setEditAttribute({ ...editAttribute, description: e.target.value })}
            />
          </FormGroup>
          {selectedAttribute?.data_type === 'string' && (
            <FormGroup label="Max Length" labelFor="edit-length">
              <InputGroup
                id="edit-length"
                type="number"
                placeholder="e.g. 255"
                value={editAttribute.max_length}
                onChange={(e) => setEditAttribute({ ...editAttribute, max_length: e.target.value })}
              />
            </FormGroup>
          )}
          {selectedAttribute?.data_type === 'reference' && !!selectedAttribute.reference_entity_id && (
            <ReferenceSettingsFields
              ownEntityId={selectedAttribute.entity_id}
              ownCode={selectedAttribute.code}
              referencedEntityId={selectedAttribute.reference_entity_id}
              attributes={attributes}
              value={editAttribute.reference}
              onChange={(reference) => setEditAttribute({ ...editAttribute, reference })}
            />
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
            <Checkbox
              checked={editAttribute.is_required}
              onChange={(e) => setEditAttribute({ ...editAttribute, is_required: (e.target as HTMLInputElement).checked })}
            >
              Required
            </Checkbox>
            <Checkbox
              checked={editAttribute.is_unique}
              onChange={(e) => setEditAttribute({ ...editAttribute, is_unique: (e.target as HTMLInputElement).checked })}
            >
              Unique
            </Checkbox>
            <Checkbox
              checked={editAttribute.is_business_key}
              onChange={(e) => setEditAttribute({ ...editAttribute, is_business_key: (e.target as HTMLInputElement).checked })}
            >
              Business Key
            </Checkbox>
          </div>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setShowEditDialog(false)} disabled={isUpdating} />
              <Button
                intent="primary"
                icon="tick"
                text="Save Changes"
                onClick={handleUpdateAttribute}
                disabled={!editAttribute.name || isUpdating}
                loading={isUpdating}
              />
            </>
          }
        />
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        title="Delete Attribute"
        icon="trash"
      >
        <DialogBody>
          <Callout intent="danger" icon="warning-sign">
            <p>Are you sure you want to delete the attribute <strong>{selectedAttribute?.name}</strong>?</p>
            <p style={{ marginTop: 8, fontSize: 12 }}>
              This will remove the attribute from entity <strong>{selectedAttribute?.entity_name}</strong>.
              This action cannot be undone.
            </p>
          </Callout>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting} />
              <Button
                intent="danger"
                icon="trash"
                text="Delete Attribute"
                onClick={handleDeleteAttribute}
                loading={isDeleting}
              />
            </>
          }
        />
      </Dialog>
    </PageLayout>
  );
}
