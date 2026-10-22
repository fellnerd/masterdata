import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { requireAccess, principalFromSession, clearPermissionCache, ROLES } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Entra group -> role on a scope. Managed by global admins only; the groups
// themselves and their members are maintained in Entra, never here.

interface PermissionRow {
  id: number
  entra_group_id: number
  tenant_id: string
  object_id: string
  group_name: string | null
  is_dynamic: boolean | null
  role: string
  scope_type: 'global' | 'model' | 'entity'
  model_id: number | null
  model_code: string | null
  entity_id: number | null
  entity_name: string | null
  created_at: string
  created_by: string | null
}

// GET /api/permissions - mappings, the Entra groups MDS has seen, and the models/entities to pick from
export async function GET() {
  const denied = await requireAccess('system')
  if (denied) return denied

  try {
    const permissions = await dbQuery<PermissionRow>(
      `SELECT p.id, p.entra_group_id, g.tenant_id, g.object_id, g.display_name AS group_name, g.is_dynamic,
              p.role, p.scope_type, p.model_id, m.code AS model_code, p.entity_id, e.name AS entity_name,
              p.created_at, p.created_by
       FROM mds_meta.permission p
       JOIN mds_meta.entra_group g ON g.id = p.entra_group_id
       LEFT JOIN mds_meta.model m ON m.id = p.model_id
       LEFT JOIN mds_meta.entity e ON e.id = p.entity_id
       WHERE p.subject_type = 'entra_group'
       ORDER BY g.display_name, p.scope_type, m.code, e.name`
    )
    const groups = await dbQuery(
      `SELECT g.id, g.tenant_id, g.object_id, g.display_name, g.is_dynamic, g.last_seen_at,
              (SELECT COUNT(*) FROM mds_meta.user_entra_group ug WHERE ug.entra_group_id = g.id) AS known_members,
              (SELECT COUNT(*) FROM mds_meta.permission p WHERE p.entra_group_id = g.id) AS permission_count
       FROM mds_meta.entra_group g
       WHERE g.kind = 'group'
       ORDER BY g.display_name`
    )
    const models = await dbQuery('SELECT id, code, name FROM mds_meta.model ORDER BY code')
    const entities = await dbQuery(
      `SELECT e.id, e.code, e.name, e.model_id, m.code AS model_code
       FROM mds_meta.entity e JOIN mds_meta.model m ON m.id = e.model_id ORDER BY m.code, e.name`
    )
    return NextResponse.json({ permissions, groups, models, entities })
  } catch (error) {
    logger.error({ error }, 'GET /api/permissions failed')
    return NextResponse.json({ error: 'Failed to load permissions', details: String(error) }, { status: 500 })
  }
}

// POST /api/permissions - { entra_group_id, role, scope_type, model_id?, entity_id?, confirm_dynamic? }
export async function POST(request: NextRequest) {
  const denied = await requireAccess('system')
  if (denied) return denied

  try {
    const body = await request.json()
    const { entra_group_id, role, scope_type, model_id, entity_id, confirm_dynamic } = body

    if (!Number.isInteger(entra_group_id)) {
      return NextResponse.json({ error: 'entra_group_id is required' }, { status: 400 })
    }
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of ${ROLES.join(', ')}` }, { status: 400 })
    }
    if (!['global', 'model', 'entity'].includes(scope_type)) {
      return NextResponse.json({ error: 'scope_type must be global, model or entity' }, { status: 400 })
    }
    if (scope_type === 'model' && !Number.isInteger(model_id)) {
      return NextResponse.json({ error: 'model_id is required for scope model' }, { status: 400 })
    }
    if (scope_type === 'entity' && !Number.isInteger(entity_id)) {
      return NextResponse.json({ error: 'entity_id is required for scope entity' }, { status: 400 })
    }

    const groups = await dbQuery<{ id: number; display_name: string | null; kind: string; is_dynamic: boolean | null }>(
      'SELECT id, display_name, kind, is_dynamic FROM mds_meta.entra_group WHERE id = @id',
      { id: entra_group_id }
    )
    const group = groups[0]
    if (!group) return NextResponse.json({ error: 'Unknown Entra group' }, { status: 404 })
    if (group.kind !== 'group') {
      return NextResponse.json({ error: 'Only Entra groups can be granted permissions (not directory roles)' }, { status: 400 })
    }
    // A dynamic group ("Alle Benutzer", a department rule, ...) fills itself - granting
    // access to it grants access to everyone the rule matches, so ask first.
    if (group.is_dynamic && confirm_dynamic !== true) {
      return NextResponse.json(
        {
          error: `"${group.display_name ?? 'This group'}" is a dynamic group: its members are added automatically, so this grants access to everyone the membership rule matches.`,
          code: 'dynamic_group',
        },
        { status: 409 }
      )
    }

    const duplicate = await dbQuery<{ id: number }>(
      `SELECT id FROM mds_meta.permission
       WHERE subject_type = 'entra_group' AND entra_group_id = @groupId AND role = @role AND scope_type = @scopeType
         AND ISNULL(model_id, 0) = @modelId AND ISNULL(entity_id, 0) = @entityId`,
      { groupId: entra_group_id, role, scopeType: scope_type, modelId: scope_type === 'model' ? model_id : 0, entityId: scope_type === 'entity' ? entity_id : 0 }
    )
    if (duplicate.length > 0) {
      return NextResponse.json({ error: 'This permission already exists for the group' }, { status: 409 })
    }

    const p = await principalFromSession()
    await dbExecute(
      `INSERT INTO mds_meta.permission (subject_type, entra_group_id, role, scope_type, model_id, entity_id, created_by)
       VALUES ('entra_group', @groupId, @role, @scopeType, @modelId, @entityId, @createdBy)`,
      {
        groupId: entra_group_id, role, scopeType: scope_type,
        modelId: scope_type === 'model' ? model_id : null,
        entityId: scope_type === 'entity' ? entity_id : null,
        createdBy: p?.email ?? 'admin',
      }
    )
    clearPermissionCache()
    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'POST /api/permissions failed')
    return NextResponse.json({ error: 'Failed to create permission', details: String(error) }, { status: 500 })
  }
}

// DELETE /api/permissions?id=
export async function DELETE(request: NextRequest) {
  const denied = await requireAccess('system')
  if (denied) return denied

  try {
    const id = parseInt(new URL(request.url).searchParams.get('id') ?? '')
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    await dbExecute("DELETE FROM mds_meta.permission WHERE id = @id AND subject_type = 'entra_group'", { id })
    clearPermissionCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ error }, 'DELETE /api/permissions failed')
    return NextResponse.json({ error: 'Failed to delete permission', details: String(error) }, { status: 500 })
  }
}
