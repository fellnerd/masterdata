import { dbQuery, dbExecute } from '@/lib/db-server'

// Entra owns security groups and their members; MDS only remembers the groups
// it has seen at login (object id + name) so permissions can be mapped to them
// and the UI can show names. Nothing here ever writes to Entra.

export interface EntraGroup {
  tenant_id: string
  object_id: string
  display_name: string | null
  kind?: string
  is_dynamic?: boolean | null
}

interface GraphGroupInfo {
  name: string | null
  kind: 'group' | 'role'
  isDynamic: boolean | null
}

// Names (and kind) of the signed-in user's groups via Microsoft Graph, using the
// delegated access token from the login. Reading group display names needs the
// delegated permission GroupMember.Read.All (admin-consented on the app
// registration); with only User.Read Graph answers with the ids but leaves the
// names empty. Entra directory ROLES show up in the same list - they are marked
// kind 'role' so the permission UI can leave them out. Best-effort: if Graph
// refuses or is unreachable the ids are still recorded.
async function fetchGroupInfo(accessToken: string): Promise<Map<string, GraphGroupInfo>> {
  const info = new Map<string, GraphGroupInfo>()
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName,groupTypes&$top=999', {
      headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: 'eventual' },
    })
    if (!res.ok) {
      console.warn(`Entra group names: Graph answered ${res.status}`)
      return info
    }
    const json = (await res.json()) as {
      value?: Array<{ id: string; displayName?: string | null; groupTypes?: string[]; '@odata.type'?: string }>
    }
    for (const g of json.value ?? []) {
      const isRole = g['@odata.type'] === '#microsoft.graph.directoryRole'
      info.set(g.id, {
        name: g.displayName ?? null,
        kind: isRole ? 'role' : 'group',
        isDynamic: isRole ? null : (g.groupTypes ?? []).includes('DynamicMembership'),
      })
    }
    if ([...info.values()].every(i => !i.name) && info.size > 0) {
      console.warn('Entra group names: Graph returned the groups without display names (GroupMember.Read.All not consented?)')
    }
  } catch (error) {
    console.warn('Entra group names: Graph request failed', error)
  }
  return info
}

// Records the groups of a sign-in (id, name, kind, dynamic) and replaces the
// user's membership snapshot.
export async function recordEntraGroups(params: {
  tenantId: string
  groupIds: string[]
  accessToken?: string
  /** Sign-in email - resolves the mds_meta.user row whose membership snapshot is replaced. */
  userEmail?: string
}): Promise<void> {
  const { tenantId, groupIds, accessToken, userEmail } = params
  if (!tenantId) return

  const info = accessToken && groupIds.length > 0 ? await fetchGroupInfo(accessToken) : new Map<string, GraphGroupInfo>()
  const dbIds: number[] = []

  for (const objectId of groupIds) {
    const g = info.get(objectId)
    const rows = await dbQuery<{ id: number }>(
      `MERGE mds_meta.entra_group AS t
       USING (SELECT @tenantId AS tenant_id, @objectId AS object_id) AS s
         ON t.tenant_id = s.tenant_id AND t.object_id = s.object_id
       WHEN MATCHED THEN
         UPDATE SET last_seen_at = GETUTCDATE(),
                    display_name = COALESCE(@name, t.display_name),
                    kind = COALESCE(@kind, t.kind),
                    is_dynamic = COALESCE(@isDynamic, t.is_dynamic)
       WHEN NOT MATCHED THEN
         INSERT (tenant_id, object_id, display_name, kind, is_dynamic)
         VALUES (@tenantId, @objectId, @name, COALESCE(@kind, 'group'), @isDynamic)
       OUTPUT inserted.id;`,
      { tenantId, objectId, name: g?.name ?? null, kind: g?.kind ?? null, isDynamic: g?.isDynamic ?? null }
    )
    if (rows[0]) dbIds.push(rows[0].id)
  }

  const user = userEmail
    ? await dbQuery<{ id: number }>('SELECT id FROM mds_meta.[user] WHERE email = @email', { email: userEmail })
    : []
  if (user[0]) {
    const userId = user[0].id
    await dbExecute('DELETE FROM mds_meta.user_entra_group WHERE user_id = @userId', { userId })
    for (const groupId of dbIds) {
      await dbExecute(
        'INSERT INTO mds_meta.user_entra_group (user_id, entra_group_id) VALUES (@userId, @groupId)',
        { userId, groupId }
      )
    }
  }
}

export async function lookupEntraGroups(tenantId: string, objectIds: string[]): Promise<EntraGroup[]> {
  if (!tenantId || objectIds.length === 0) return []
  const placeholders = objectIds.map((_, i) => `@id${i}`).join(', ')
  const params: Record<string, unknown> = { tenantId }
  objectIds.forEach((id, i) => { params[`id${i}`] = id })
  return dbQuery<EntraGroup>(
    `SELECT tenant_id, object_id, display_name FROM mds_meta.entra_group
     WHERE tenant_id = @tenantId AND object_id IN (${placeholders})`,
    params
  )
}

// Fills in names (and the kind: group or directory role) for groups MDS has only
// seen as ids - e.g. the group of a member who has not signed in since names were
// recorded. Runs with the signed-in ADMIN's delegated token (GroupMember.Read.All),
// so it works for any group they can see, not just their own. Best-effort.
export async function resolveMissingGroupNames(tenantId: string, accessToken: string): Promise<void> {
  const missing = await dbQuery<{ id: number; object_id: string }>(
    `SELECT TOP 50 id, object_id FROM mds_meta.entra_group
     WHERE tenant_id = @tenantId AND display_name IS NULL`,
    { tenantId }
  )
  const headers = { Authorization: `Bearer ${accessToken}` }

  for (const g of missing) {
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/groups/${g.object_id}?$select=id,displayName,groupTypes`, { headers })
      if (res.ok) {
        const json = (await res.json()) as { displayName?: string | null; groupTypes?: string[] }
        if (json.displayName) {
          await dbExecute(
            `UPDATE mds_meta.entra_group SET display_name = @name, kind = 'group', is_dynamic = @dyn WHERE id = @id`,
            { id: g.id, name: json.displayName, dyn: (json.groupTypes ?? []).includes('DynamicMembership') ? 1 : 0 }
          )
        }
        continue
      }
      if (res.status === 401 || res.status === 403) return // token expired / no permission: nothing more to try
      // not a group: probably a directory role (e.g. "Cloud Application Administrator")
      const obj = await fetch(`https://graph.microsoft.com/v1.0/directoryObjects/${g.object_id}`, { headers })
      if (obj.ok) {
        const json = (await obj.json()) as { '@odata.type'?: string; displayName?: string | null }
        if (json['@odata.type'] === '#microsoft.graph.directoryRole') {
          await dbExecute(
            `UPDATE mds_meta.entra_group SET display_name = COALESCE(@name, display_name), kind = 'role' WHERE id = @id`,
            { id: g.id, name: json.displayName ?? null }
          )
        }
      }
    } catch {
      // network problem - leave the id as is
    }
  }
}
