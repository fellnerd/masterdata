import { NextRequest, NextResponse } from 'next/server'
import { dbExecute, dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/deploy/data/status
 * Updates commit status after successful dbt execution
 * Called by the worker after data deployment completes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { deploymentId, commitIds, status } = body
    
    if (!deploymentId || !commitIds || !status) {
      return NextResponse.json(
        { error: 'deploymentId, commitIds and status are required' },
        { status: 400 }
      )
    }
    
    logger.info({ deploymentId, commitIds, status }, 'Updating commit status after deploy')
    
    // Update commit status
    for (const commitId of commitIds) {
      await dbExecute(
        `UPDATE mds_stage.[commit] 
         SET status = @status, 
             deployed_at = GETUTCDATE()
         WHERE id = @commitId`,
        { commitId, status }
      )
    }
    
    // Update deployment log
    await dbExecute(
      `UPDATE mds_load.deployment_log 
       SET status = @status, 
           completed_at = GETUTCDATE()
       WHERE deployment_id = @deploymentId`,
      { deploymentId, status }
    )
    
    // If status is 'deployed' (full deploy to master), remove DELETE records from staged_record
    // DELETE operations are soft-deletes - after master processes them, they should be removed
    if (status === 'deployed') {
      const commitIdList = commitIds.join(',')
      const deleteResult = await dbExecute(
        `DELETE FROM mds_stage.staged_record 
         WHERE commit_id IN (${commitIdList}) AND operation = 'DELETE'`
      )
      logger.info({ commitIds, deleteResult }, 'Removed DELETE records from staged_record after master deploy')
    }
    
    return NextResponse.json({
      success: true,
      message: `Updated ${commitIds.length} commits to status '${status}'`
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to update commit status')
    return NextResponse.json(
      { error: 'Failed to update status', details: String(error) },
      { status: 500 }
    )
  }
}
