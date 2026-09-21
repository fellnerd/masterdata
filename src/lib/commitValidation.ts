import { dbQuery } from '@/lib/db-server'

export interface DuplicateBusinessKey {
  business_key: string
  count: number
  record_ids: number[]
}

// Business keys that appear on more than one record in the set a commit is
// about to cover. Two records for one key in a single commit make the load
// model's MERGE fail ("attempted to UPDATE or DELETE the same row more than
// once", SQL 8672) or - if the key is new - write it to mds_load and
// mds_master twice; catching it here names the offending keys instead.
//
// With `recordIds` only those records are considered (a commit of specific
// change_ids); without, every pending, uncommitted record of the entity.
export async function findDuplicateBusinessKeys(
  entityId: number,
  recordIds?: number[]
): Promise<DuplicateBusinessKey[]> {
  const params: Record<string, unknown> = { entityId }
  let scope = `status = 'PENDING' AND commit_id IS NULL`

  if (recordIds && recordIds.length > 0) {
    const placeholders = recordIds.map((id, i) => {
      params[`rid${i}`] = id
      return `@rid${i}`
    })
    scope = `id IN (${placeholders.join(', ')})`
  }

  const rows = await dbQuery<{ business_key: string; cnt: number; ids: string }>(
    `SELECT MAX(business_key) AS business_key, COUNT(*) AS cnt,
            STRING_AGG(CAST(id AS NVARCHAR(20)), ',') AS ids
     FROM mds_stage.staged_record
     WHERE entity_id = @entityId AND ${scope}
     GROUP BY business_key_hash
     HAVING COUNT(*) > 1
     ORDER BY MAX(business_key)`,
    params
  )

  return rows.map(r => ({
    business_key: r.business_key,
    count: r.cnt,
    record_ids: r.ids.split(',').map(Number)
  }))
}

export function describeDuplicateBusinessKeys(duplicates: DuplicateBusinessKey[], limit = 10): string {
  const shown = duplicates
    .slice(0, limit)
    .map(d => `"${d.business_key}" (${d.count} records: ${d.record_ids.join(', ')})`)
    .join('; ')
  const more = duplicates.length > limit ? `; ... and ${duplicates.length - limit} more` : ''
  return (
    `${duplicates.length} business key(s) appear on more than one pending record - ` +
    `each key may only be committed once. Fix or delete the duplicates first: ${shown}${more}`
  )
}
