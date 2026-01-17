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
  
  logger.info({ commitId }, 'GET /api/commits/[commitId]/records')
  
  try {
    const sql = `
      SELECT 
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
    
    const records = await dbQuery<StagedRecord>(sql, { commitId })
    
    // Parse JSON payloads
    const parsedRecords = records.map(record => ({
      ...record,
      data: record.payload ? JSON.parse(record.payload) : null,
      previousData: record.previous_data ? JSON.parse(record.previous_data) : null
    }))
    
    return NextResponse.json({
      data: parsedRecords,
      total: records.length
    })
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to fetch commit records')
    return NextResponse.json(
      { error: 'Failed to fetch commit records', details: String(error) },
      { status: 500 }
    )
  }
}
