import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StagedRecord {
  id: number
  business_key: string
  operation: string
  status: string
  payload: string
  previous_data: string | null
  created_at: string
  created_by: string
}

// GET /api/commits/[commitId]/records - Get records for a specific commit
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  const { commitId: commitIdStr } = await params
  const commitId = parseInt(commitIdStr)

  const { searchParams } = new URL(request.url)
  // Commits can hold thousands of records (seen: 2995) - rendering all of
  // them at once as a Tag per data field previously froze the browser tab.
  // Default to a capped preview; the UI shows "showing X of Y" when
  // truncated rather than silently hiding the rest.
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100') || 100, 1), 500)

  logger.info({ commitId, limit }, 'GET /api/commits/[commitId]/records')

  try {
    const totalResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [mds_stage].[staged_record] WHERE commit_id = @commitId`,
      { commitId }
    )
    const total = totalResult[0]?.total || 0

    const sql = `
      SELECT TOP (@limit)
        id,
        business_key,
        operation,
        status,
        payload,
        previous_data,
        created_at,
        created_by
      FROM [mds_stage].[staged_record]
      WHERE commit_id = @commitId
      ORDER BY id ASC
    `

    const records = await dbQuery<StagedRecord>(sql, { commitId, limit })

    // Parse JSON payloads
    const parsedRecords = records.map(record => ({
      ...record,
      data: record.payload ? JSON.parse(record.payload) : null,
      previousData: record.previous_data ? JSON.parse(record.previous_data) : null
    }))

    return NextResponse.json({
      data: parsedRecords,
      total,
      truncated: total > parsedRecords.length
    })
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to fetch commit records')
    return NextResponse.json(
      { error: 'Failed to fetch commit records', details: String(error) },
      { status: 500 }
    )
  }
}
