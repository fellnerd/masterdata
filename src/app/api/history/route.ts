import { NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  logger.info('GET /api/history')
  
  try {
    // Query staged records with entity and commit information
    const result = await dbQuery(`
      SELECT 
        sr.id,
        sr.entity_id,
        e.name as entity_name,
        sr.business_key as record_key,
        sr.operation,
        sr.previous_data as old_values,
        sr.data as new_values,
        sr.created_at as changed_at,
        sr.created_by as changed_by,
        sr.commit_id,
        c.code as commit_code,
        c.status as commit_status,
        CASE 
          WHEN c.id IS NOT NULL AND c.status != 'draft' THEN CAST(1 AS BIT) 
          ELSE CAST(0 AS BIT) 
        END as is_committed
      FROM mds_stage.staged_record sr
      INNER JOIN mds_meta.entity e ON sr.entity_id = e.id
      LEFT JOIN mds_stage.[commit] c ON sr.commit_id = c.id
      ORDER BY sr.created_at DESC
    `)

    // Transform the results
    const history = (result as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      entity_id: row.entity_id,
      entity_name: row.entity_name,
      record_key: row.record_key,
      operation: row.operation,
      old_values: row.old_values ? (typeof row.old_values === 'string' ? JSON.parse(row.old_values) : row.old_values) : null,
      new_values: row.new_values ? (typeof row.new_values === 'string' ? JSON.parse(row.new_values) : row.new_values) : null,
      changed_at: row.changed_at,
      changed_by: row.changed_by,
      commit_id: row.commit_id,
      commit_code: row.commit_code,
      is_committed: Boolean(row.is_committed)
    }))

    logger.info(`Found ${history.length} history entries`)
    return NextResponse.json(history)
  } catch (error) {
    logger.error({ error }, 'History API error')
    return NextResponse.json(
      { error: 'Failed to fetch history', details: String(error) },
      { status: 500 }
    )
  }
}
