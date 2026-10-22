import { dbQuery, dbExecute } from '@/lib/db-server'

// Entra owns security groups and their members; MDS only remembers the groups
// it has seen at login (object id + name) so permissions can be mapped to them
// and the UI can show names. Nothing here ever writes to Entra.

export interface EntraGroup {
  tenant_id: string
  object_id: string
  display_name: string | null
}

// Names of the signed-in user's groups via Microsoft Graph, using the
// delegated access token from the login. Reading group display names needs the
// delegated permission GroupMember.Read.All (admin-consented on the app
// registration); with only User.Read Graph answers with the ids but leaves the
// names empty. Best-effort: if Graph refuses or is unreachable the ids are
// still recorded and the UI falls back to showing them.
async function fetchGroupNames(accessToken: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName&$top=999', {
      headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: 'eventual' },
    })
    if (!res.ok) {
      console.warn(`Entra group names: Graph answered ${res.status}`)
      return names
    }
    const json = (await res.json()) as { value?: Array<{ id: string; displayName?: string | null }> }
    for (const g of json.value ?? []) if (g.displayName) names.set(g.id, g.displayName)
    if (names.size === 0 && (json.value?.length ?? 0) > 0) {
      console.warn('Entra group names: Graph returned the groups without display names (GroupMember.Read.All not consented?)')
    }
  } catch (error) {
    console.warn('Entra group names: Graph request failed', error)
  }
  return names
}

export async function recordEntraGroups(params: {
  tenantId: string
  groupIds: string[]
  accessToken?: string
}): Promise<void> {
  const { tenantId, groupIds, accessToken } = params
  if (!tenantId || groupIds.length === 0) return

  const names = accessToken ? await fetchGroupNames(accessToken) : new Map<string, string>()

  for (const objectId of groupIds) {
    await dbExecute(
      `MERGE mds_meta.entra_group AS t
       USING (SELECT @tenantId AS tenant_id, @objectId AS object_id) AS s
         ON t.tenant_id = s.tenant_id AND t.object_id = s.object_id
       WHEN MATCHED THEN
         UPDATE SET last_seen_at = GETUTCDATE(),
                    display_name = COALESCE(@name, t.display_name)
       WHEN NOT MATCHED THEN
         INSERT (tenant_id, object_id, display_name) VALUES (@tenantId, @objectId, @name);`,
      { tenantId, objectId, name: names.get(objectId) ?? null }
    )
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
