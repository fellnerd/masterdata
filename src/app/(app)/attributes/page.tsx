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
import { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

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

export default function AttributesPage() {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, businessKeys: 0, references: 0, entities: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
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
  }>({
    name: '',
    description: '',
    is_required: false,
    is_unique: false,
    is_business_key: false,
    max_length: '',
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
    reference_entity_id: 0
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

  const getTypeIcon = (dataType: string): IconName => {
    switch (dataType) {
      case 'string':
        return 'font';
      case 'number':
        return 'numerical';
      case 'date':
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
    const matchesEntity = entityFilter === 'all' || attr.entity_name === entityFilter;
    const matchesType = typeFilter === 'all' || attr.data_type === typeFilter;
    return matchesSearch && matchesEntity && matchesType;
  });

  const uniqueEntityNames = [...new Set(attributes.map((a) => a.entity_name))];
  const dataTypes = [...new Set(attributes.map((a) => a.data_type))];

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
          reference_entity_id: newAttribute.data_type === 'reference' ? newAttribute.reference_entity_id : null
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
              {uniqueEntityNames.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
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
              onClick={() => setShowAddDialog(true)}
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
                        <Tag icon="link" minimal interactive>
                          {attr.reference_entity_code}
                        </Tag>
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
                    setNewAttribute({ ...newAttribute, reference_entity_id: Number(e.target.value) })
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
