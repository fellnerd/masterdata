import { dbQuery, dbExecute } from '@/lib/db-server'

// Who changed which permission / sharing / user, and when. Best-effort: a failed
// log write never blocks the change itself.

export interface AuditEntry {
  id: number
  at: string
  actor: string | null
  action: string
  subject: string | null
  detail: string | null
}

export async function recordAudit(entry: { actor?: string | null; action: string; subject?: string | null; detail?: string | null }): Promise<void> {
  try {
    await dbExecute(
      'INSERT INTO mds_meta.permission_audit (actor, action, subject, detail) VALUES (@actor, @action, @subject, @detail)',
      {
        actor: entry.actor ?? null,
        action: entry.action,
        subject: entry.subject?.slice(0, 500) ?? null,
        detail: entry.detail?.slice(0, 1000) ?? null,
      }
    )
  } catch (error) {
    console.error('Failed to write the permission audit log:', error)
  }
}

export async function recentAudit(limit = 50): Promise<AuditEntry[]> {
  return dbQuery<AuditEntry>(
    `SELECT TOP (${Math.min(Math.max(limit, 1), 200)}) id, at, actor, action, subject, detail
     FROM mds_meta.permission_audit ORDER BY id DESC`
  )
}
