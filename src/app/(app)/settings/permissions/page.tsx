'use client';

import {
  Button, Callout, Dialog, DialogBody, DialogFooter, FormGroup, HTMLSelect, HTMLTable,
  NonIdealState, Tag, Tooltip, Alert,
} from '@blueprintjs/core';
import { useCallback, useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { SectionHeader } from '@/components/ui/SectionHeader';

interface Permission {
  id: number;
  entra_group_id: number;
  tenant_id: string;
  object_id: string;
  group_name: string | null;
  is_dynamic: boolean | null;
  role: string;
  scope_type: 'global' | 'model' | 'entity';
  model_code: string | null;
  entity_name: string | null;
  created_by: string | null;
}
interface Group {
  id: number;
  object_id: string;
  display_name: string | null;
  is_dynamic: boolean | null;
  known_members: number;
  permission_count: number;
}
interface AuditEntry { id: number; at: string; actor: string | null; action: string; subject: string | null; detail: string | null }
interface Model { id: number; code: string; name: string }
interface Entity { id: number; code: string; name: string; model_id: number; model_code: string }

const ROLES = ['viewer', 'editor', 'approver', 'admin'] as const;
const ROLE_HELP: Record<string, string> = {
  viewer: 'lesen',
  editor: 'lesen, Datensätze pflegen, Commits erstellen',
  approver: 'wie Editor, plus Commits freigeben und Daten deployen',
  admin: 'wie Approver, plus Schema ändern und deployen (global: zusätzlich Models, Benutzer, Rechte, Jobs)',
};
const roleIntent = (r: string) => (r === 'admin' ? 'danger' : r === 'approver' ? 'warning' : r === 'editor' ? 'primary' : 'none');

// sg-mds-<kunde>-<model>-<rolle>  or  sg-mds-<kunde>-<rolle> (global)
function suggestFromName(name: string | null, models: Model[]) {
  if (!name) return null;
  const m = name.match(/^sg-mds-[^-]+-(?:(.+)-)?(viewer|editor|approver|admin)$/i);
  if (!m) return null;
  const role = m[2].toLowerCase();
  if (!m[1]) return { role, scope: 'global' as const, modelId: 0 };
  const model = models.find((x) => x.code.toLowerCase() === m[1].toLowerCase());
  return model ? { role, scope: 'model' as const, modelId: model.id } : null;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ groupId: 0, role: 'viewer', scope: 'model', modelId: 0, entityId: 0 });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dynamicWarning, setDynamicWarning] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Permission | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions');
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load permissions');
      const json = await res.json();
      setPermissions(json.permissions);
      setGroups(json.groups);
      setModels(json.models);
      setEntities(json.entities);
      setAudit(json.audit ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickGroup = (groupId: number) => {
    const g = groups.find((x) => x.id === groupId);
    const s = suggestFromName(g?.display_name ?? null, models);
    setForm((f) => ({
      ...f,
      groupId,
      ...(s ? { role: s.role, scope: s.scope, modelId: s.modelId || f.modelId } : {}),
    }));
  };

  const save = async (confirmDynamic = false) => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entra_group_id: form.groupId,
          role: form.role,
          scope_type: form.scope,
          model_id: form.scope === 'model' ? form.modelId : undefined,
          entity_id: form.scope === 'entity' ? form.entityId : undefined,
          confirm_dynamic: confirmDynamic,
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.code === 'dynamic_group') {
        setDynamicWarning(json.error);
        return;
      }
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setShowAdd(false);
      setDynamicWarning(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    await fetch(`/api/permissions?id=${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await load();
  };

  const scopeLabel = (p: Permission) =>
    p.scope_type === 'global' ? <Tag minimal icon="globe">Global</Tag>
      : p.scope_type === 'model' ? <Tag minimal icon="cube">Model {p.model_code}</Tag>
        : <Tag minimal icon="th">Entity {p.entity_name}</Tag>;

  const canSave =
    form.groupId > 0 &&
    (form.scope === 'global' || (form.scope === 'model' && form.modelId > 0) || (form.scope === 'entity' && form.entityId > 0));

  return (
    <PageLayout
      title="Permissions"
      breadcrumb={['Settings', 'Permissions']}
      loading={loading}
      loadingText="Loading permissions..."
      error={error}
      onRetry={load}
    >
      <Callout icon="info-sign" style={{ marginBottom: 16 }}>
        Wer Zugriff hat, bestimmt <strong>Entra</strong>: Gruppen und Mitglieder werden dort gepflegt. Hier wird nur
        festgelegt, <strong>was</strong> eine Gruppe darf. Empfohlene Namen: <code>sg-mds-&lt;kunde&gt;-&lt;model&gt;-&lt;rolle&gt;</code>{' '}
        (z. B. <code>sg-mds-ppmc-ascem-editor</code>) bzw. <code>sg-mds-&lt;kunde&gt;-admin</code> für globale Rechte.
        Gruppen erscheinen hier, sobald sich ein Mitglied zum ersten Mal angemeldet hat. Rechte gelten nach der
        nächsten Anmeldung der Mitglieder.
      </Callout>

      <SectionHeader
        title="Berechtigungen"
        actions={
          <Button
            icon="add"
            intent="primary"
            disabled={groups.length === 0}
            onClick={() => { setForm({ groupId: 0, role: 'viewer', scope: 'model', modelId: 0, entityId: 0 }); setFormError(null); setShowAdd(true); }}
          >
            Add Permission
          </Button>
        }
      />

      {permissions.length > 0 ? (
        <HTMLTable striped style={{ width: '100%', marginBottom: 32 }}>
          <thead>
            <tr><th>Entra-Gruppe</th><th>Rolle</th><th>Gilt für</th><th>Angelegt von</th><th /></tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.group_name ?? <code>{p.object_id}</code>}
                  {p.is_dynamic && (
                    <Tooltip content="Dynamische Gruppe: Mitglieder werden automatisch nach einer Regel aufgenommen">
                      <Tag intent="warning" minimal style={{ marginLeft: 6 }}>dynamisch</Tag>
                    </Tooltip>
                  )}
                </td>
                <td><Tag intent={roleIntent(p.role)} minimal>{p.role}</Tag></td>
                <td>{scopeLabel(p)}</td>
                <td className="text-muted">{p.created_by ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <Button icon="trash" minimal small intent="danger" onClick={() => setToDelete(p)} />
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      ) : (
        <NonIdealState icon="shield" title="Noch keine Berechtigungen" description="Ohne Zuordnung hat niemand außer den bisherigen direkten Rollen Zugriff." />
      )}

      <SectionHeader title="Bekannte Entra-Gruppen" />
      {groups.length > 0 ? (
        <HTMLTable striped style={{ width: '100%' }}>
          <thead>
            <tr><th>Gruppe</th><th>Bekannte Mitglieder</th><th>Berechtigungen</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  {g.display_name ?? <code>{g.object_id}</code>}
                  {g.is_dynamic && <Tag intent="warning" minimal style={{ marginLeft: 6 }}>dynamisch</Tag>}
                </td>
                <td>{g.known_members}</td>
                <td>{g.permission_count > 0 ? g.permission_count : <span className="text-muted">keine</span>}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      ) : (
        <NonIdealState icon="people" title="Noch keine Gruppen gesehen" description="Sobald sich ein Benutzer mit Entra-Gruppen anmeldet, erscheinen sie hier." />
      )}

      <SectionHeader title="Änderungsprotokoll" />
      {audit.length > 0 ? (
        <HTMLTable striped style={{ width: '100%', marginTop: 8 }}>
          <thead>
            <tr><th>Zeitpunkt</th><th>Von</th><th>Aktion</th><th>Betrifft</th><th>Details</th></tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('de-DE')}</td>
                <td>{a.actor ?? '—'}</td>
                <td><Tag minimal intent={a.action === 'revoke' || a.action === 'user_delete' ? 'danger' : 'none'}>{a.action}</Tag></td>
                <td>{a.subject ?? '—'}</td>
                <td className="text-muted">{a.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      ) : (
        <NonIdealState icon="history" title="Noch keine Änderungen protokolliert" />
      )}

      <Dialog isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Permission" icon="shield">
        <DialogBody>
          <FormGroup label="Entra-Gruppe" labelFor="perm-group">
            <HTMLSelect id="perm-group" fill value={form.groupId} onChange={(e) => pickGroup(Number(e.target.value))}>
              <option value={0}>Gruppe wählen...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {(g.display_name ?? g.object_id) + (g.is_dynamic ? ' (dynamisch)' : '')}
                </option>
              ))}
            </HTMLSelect>
          </FormGroup>
          <FormGroup label="Rolle" labelFor="perm-role" helperText={ROLE_HELP[form.role]}>
            <HTMLSelect id="perm-role" fill value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </HTMLSelect>
          </FormGroup>
          <FormGroup label="Gilt für" labelFor="perm-scope">
            <HTMLSelect id="perm-scope" fill value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="global">Alles (global)</option>
              <option value="model">Ein Model</option>
              <option value="entity">Eine Entity</option>
            </HTMLSelect>
          </FormGroup>
          {form.scope === 'model' && (
            <FormGroup label="Model" labelFor="perm-model">
              <HTMLSelect id="perm-model" fill value={form.modelId} onChange={(e) => setForm({ ...form, modelId: Number(e.target.value) })}>
                <option value={0}>Model wählen...</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
              </HTMLSelect>
            </FormGroup>
          )}
          {form.scope === 'entity' && (
            <FormGroup label="Entity" labelFor="perm-entity">
              <HTMLSelect id="perm-entity" fill value={form.entityId} onChange={(e) => setForm({ ...form, entityId: Number(e.target.value) })}>
                <option value={0}>Entity wählen...</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.name} ({en.model_code})</option>)}
              </HTMLSelect>
            </FormGroup>
          )}
          {formError && <Callout intent="danger" icon="error">{formError}</Callout>}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setShowAdd(false)} disabled={saving} />
              <Button intent="primary" icon="tick" text="Save" disabled={!canSave || saving} loading={saving} onClick={() => save(false)} />
            </>
          }
        />
      </Dialog>

      <Alert
        isOpen={dynamicWarning !== null}
        intent="warning"
        icon="warning-sign"
        cancelButtonText="Abbrechen"
        confirmButtonText="Trotzdem zuordnen"
        onCancel={() => setDynamicWarning(null)}
        onConfirm={() => save(true)}
      >
        <p>{dynamicWarning}</p>
      </Alert>

      <Alert
        isOpen={toDelete !== null}
        intent="danger"
        icon="trash"
        cancelButtonText="Abbrechen"
        confirmButtonText="Entfernen"
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      >
        <p>
          Berechtigung <strong>{toDelete?.role}</strong> für <strong>{toDelete?.group_name}</strong> entfernen? Mitglieder
          verlieren den Zugriff nach kurzer Zeit (spätestens nach ca. 15 Sekunden).
        </p>
      </Alert>
    </PageLayout>
  );
}
