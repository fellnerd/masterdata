import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { addJob } from '@/lib/queue/queue'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface Commit {
  id: number
  code: string
  description: string | null
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'deployed'
  entity_id: number
  entity_code?: string
  entity_name?: string
  record_count: number
  created_at: string
  created_by: string
  approved_at: string | null
  approved_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  review_comment: string | null
  deployed_at: string | null
  deployed_by: string | null
}

// GET /api/commits - List commits
export async function GET(request: NextRequest) {
  logger.info('GET /api/commits')
  
  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    const status = searchParams.get('status')
    
    let sql = `
      SELECT 
        c.id,
        c.code,
        c.description,
        c.status,
        c.entity_id,
        e.code AS entity_code,
        e.name AS entity_name,
        c.record_count,
        c.created_at,
        c.created_by,
        c.approved_at,
        c.approved_by,
        c.rejected_at,
        c.rejected_by,
        c.review_comment,
        c.deployed_at,
        c.deployed_by
      FROM [mds_stage].[commit] c
      INNER JOIN [mds_meta].[entity] e ON e.id = c.entity_id
      WHERE 1=1
    `
    
    const params: Record<string, unknown> = {}
    
    if (entityId) {
      sql += ` AND c.entity_id = @entityId`
      params.entityId = parseInt(entityId)
    }
    
    if (status) {
      sql += ` AND c.status = @status`
      params.status = status
    }
    
    sql += ` ORDER BY c.created_at DESC`
    
    const results = await dbQuery<Commit>(sql, params)
    
    // Compute summary stats
    const draft = results.filter(c => c.status === 'draft').length
    const pending = results.filter(c => c.status === 'pending').length
    const approved = results.filter(c => c.status === 'approved').length
    const deployed = results.filter(c => c.status === 'deployed').length
    
    // Get pending schema deployments count
    const schemaDeployments = await dbQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM mds_meta.schema_deployment WHERE status = 'pending'`
    )
    const schemaPending = schemaDeployments.length > 0 ? schemaDeployments[0].count : 0
    
    return NextResponse.json({
      data: results,
      total: results.length,
      summary: {
        total: results.length,
        draft,
        pending,
        approved,
        deployed,
        schema_pending: schemaPending
      }
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch commits')
    return NextResponse.json(
      { error: 'Failed to fetch commits', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/commits - Create new commit (submit draft records)
export async function POST(request: NextRequest) {
  logger.info('POST /api/commits')
  
  try {
    const body = await request.json()
    const { 
      entity_id, 
      description,
      change_ids, // Optional: specific staged_record IDs to commit
      created_by = 'admin'
    } = body
    
    if (!entity_id) {
      return NextResponse.json(
        { error: 'entity_id is required' },
        { status: 400 }
      )
    }

    // Generate commit code
    const now = new Date()
    const code = `CMT-${entity_id}-${now.getTime()}`
    
    // Option 1: Commit specific change_ids
    if (change_ids && Array.isArray(change_ids) && change_ids.length > 0) {
      // Filter to only include records that are actually committable (status='pending')
      // Records with status='loaded', 'committed', 'deployed' should NOT be committed again
      const idParams: Record<string, unknown> = {}
      const idPlaceholders = change_ids.map((id: number, idx: number) => {
        idParams[`id${idx}`] = id
        return `@id${idx}`
      }).join(', ')
      
      const committableRecords = await dbQuery<{ id: number }>(
        `SELECT id FROM [mds_stage].[staged_record] 
         WHERE id IN (${idPlaceholders}) 
           AND entity_id = ${entity_id}
           AND status = 'pending'`,
        idParams
      )
      
      if (committableRecords.length === 0) {
        return NextResponse.json(
          { error: 'No pending records to commit. Records may already be committed or loaded.' },
          { status: 400 }
        )
      }
      
      const committableIds = committableRecords.map(r => r.id)
      logger.info({ 
        requested: change_ids.length, 
        committable: committableIds.length,
        skipped: change_ids.length - committableIds.length 
      }, 'Filtering committable records')
      
      // Create a new commit with only committable records
      await dbExecute(
        `INSERT INTO [mds_stage].[commit] (entity_id, code, description, status, record_count, created_at, created_by)
         VALUES (@entityId, @code, @description, 'pending', @recordCount, GETUTCDATE(), @createdBy)`,
        { 
          entityId: entity_id,
          code,
          description: description || null,
          recordCount: committableIds.length,
          createdBy: created_by
        }
      )
      
      // Get the new commit ID
      const newCommit = await dbQuery<{ id: number }>(
        `SELECT id FROM [mds_stage].[commit] WHERE code = @code`,
        { code }
      )
      
      if (newCommit.length === 0) {
        throw new Error('Failed to create commit')
      }
      
      const commitId = newCommit[0].id
      
      // Update only the committable staged_records
      const updateParams: Record<string, unknown> = { commitId }
      const updatePlaceholders = committableIds.map((id: number, idx: number) => {
        updateParams[`id${idx}`] = id
        return `@id${idx}`
      }).join(', ')
      
      await dbExecute(
        `UPDATE [mds_stage].[staged_record] 
         SET commit_id = @commitId, status = 'committed'
         WHERE id IN (${updatePlaceholders})`,
        updateParams
      )
      
      // Fetch the created commit
      const result = await dbQuery<Commit>(
        `SELECT c.*, e.code AS entity_code, e.name AS entity_name
         FROM [mds_stage].[commit] c
         INNER JOIN [mds_meta].[entity] e ON e.id = c.entity_id
         WHERE c.id = @commitId`,
        { commitId }
      )
      
      return NextResponse.json({
        ...result[0],
        committed_count: committableIds.length,
        skipped_count: change_ids.length - committableIds.length
      }, { status: 201 })
    }
    
    // Option 2: Commit ALL pending records for this entity (no commit_id yet)
    // Check if there are pending staged_records without a commit
    const pendingRecords = await dbQuery<{ count: number }>(
      `SELECT COUNT(*) as count 
       FROM [mds_stage].[staged_record] 
       WHERE entity_id = @entityId AND status = 'PENDING' AND commit_id IS NULL`,
      { entityId: entity_id }
    )
    
    if (pendingRecords[0].count === 0) {
      return NextResponse.json(
        { error: 'No pending records to commit' },
        { status: 400 }
      )
    }
    
    const pendingCount = pendingRecords[0].count
    
    // For large commits (> 1000 records), use background job
    const USE_BACKGROUND_JOB = pendingCount > 1000
    
    // Create a new commit record first (status='processing' for background, 'pending' for sync)
    const commitStatus = USE_BACKGROUND_JOB ? 'processing' : 'pending'
    await dbExecute(
      `INSERT INTO [mds_stage].[commit] (entity_id, code, description, status, record_count, created_at, created_by)
       VALUES (@entityId, @code, @description, @status, @recordCount, GETUTCDATE(), @createdBy)`,
      { 
        entityId: entity_id,
        code,
        description: description || null,
        status: commitStatus,
        recordCount: pendingCount,
        createdBy: created_by
      }
    )
    
    // Get the new commit ID
    const newCommit = await dbQuery<{ id: number }>(
      `SELECT id FROM [mds_stage].[commit] WHERE code = @code`,
      { code }
    )
    
    if (newCommit.length === 0) {
      throw new Error('Failed to create commit')
    }
    
    const commitId = newCommit[0].id
    
    if (USE_BACKGROUND_JOB) {
      // Queue background job for large commits
      const job = await addJob(
        'bulk-commit',
        `commit-${commitId}`,
        created_by,
        created_by,
        { entityId: entity_id, commitId: commitId, description: description || undefined }
      )
      
      logger.info({ commitId, pendingCount, jobId: job.id }, 'Queued bulk commit job')
      
      return NextResponse.json({
        id: commitId,
        code,
        status: 'processing',
        record_count: pendingCount,
        job_id: job.id,
        message: `Bulk commit queued for ${pendingCount.toLocaleString()} records. Check Jobs page for progress.`
      }, { status: 202 }) // 202 Accepted
    }
    
    // For small commits, do it synchronously
    await dbExecute(
      `UPDATE [mds_stage].[staged_record] 
       SET commit_id = @commitId, status = 'COMMITTED'
       WHERE entity_id = @entityId AND status = 'PENDING' AND commit_id IS NULL`,
      { commitId, entityId: entity_id }
    )
    
    // Fetch the created commit
    const result = await dbQuery<Commit>(
      `SELECT c.*, e.code AS entity_code, e.name AS entity_name
       FROM [mds_stage].[commit] c
       INNER JOIN [mds_meta].[entity] e ON e.id = c.entity_id
       WHERE c.id = @commitId`,
      { commitId }
    )
    
    logger.info({ commitId, recordCount: pendingCount }, 'Created commit for all pending records')
    
    return NextResponse.json({
      ...result[0],
      committed_count: pendingCount
    }, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create commit')
    return NextResponse.json(
      { error: 'Failed to create commit', details: String(error) },
      { status: 500 }
    )
  }
}

// PATCH /api/commits - Approve/Reject commit
export async function PATCH(request: NextRequest) {
  logger.info('PATCH /api/commits')
  
  try {
    const body = await request.json()
    const { 
      id,
      action, // 'approve' | 'reject' | 'deploy'
      comment,
      user = 'admin'
    } = body
    
    if (!id || !action) {
      return NextResponse.json(
        { error: 'id and action are required' },
        { status: 400 }
      )
    }
    
    let sql = ''
    const params: Record<string, unknown> = { id, user }
    
    switch (action) {
      case 'approve':
        sql = `UPDATE [mds_stage].[commit] 
               SET status = 'approved', approved_at = GETUTCDATE(), approved_by = @user, review_comment = @comment
               WHERE id = @id AND status = 'pending'`
        params.comment = comment || null
        break
      case 'reject':
        sql = `UPDATE [mds_stage].[commit] 
               SET status = 'rejected', rejected_at = GETUTCDATE(), rejected_by = @user, review_comment = @comment
               WHERE id = @id AND status = 'pending'`
        params.comment = comment || null
        
        // Reset staged_records to their previous state:
        // - Records that were already loaded (have previous_data): restore to 'loaded' with original data
        // - New records (no previous_data, operation='INSERT'): keep as 'pending' so they can be corrected
        
        // 1. Restore already-loaded records to their previous state (data, operation=INSERT, status=loaded)
        await dbExecute(
          `UPDATE [mds_stage].[staged_record] 
           SET status = 'loaded', 
               data = previous_data,
               payload = previous_data,
               operation = 'INSERT',
               previous_data = NULL,
               commit_id = NULL
           WHERE commit_id = @id AND previous_data IS NOT NULL`,
          { id }
        )
        
        // 2. New records (never deployed, no previous_data) - delete them completely since they were rejected
        await dbExecute(
          `DELETE FROM [mds_stage].[staged_record] 
           WHERE commit_id = @id AND previous_data IS NULL`,
          { id }
        )
        break
      case 'deploy':
        sql = `UPDATE [mds_stage].[commit] 
               SET status = 'deployed', deployed_at = GETUTCDATE(), deployed_by = @user
               WHERE id = @id AND status = 'approved'`
        break
      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: approve, reject, or deploy' },
          { status: 400 }
        )
    }
    
    await dbExecute(sql, params)
    
    // Fetch the updated commit
    const updated = await dbQuery<Commit>(
      `SELECT c.*, e.code AS entity_code, e.name AS entity_name
       FROM [mds_stage].[commit] c
       INNER JOIN [mds_meta].[entity] e ON e.id = c.entity_id
       WHERE c.id = @id`,
      { id }
    )
    
    return NextResponse.json(updated[0])
  } catch (error) {
    logger.error({ error }, 'Failed to update commit')
    return NextResponse.json(
      { error: 'Failed to update commit', details: String(error) },
      { status: 500 }
    )
  }
}
