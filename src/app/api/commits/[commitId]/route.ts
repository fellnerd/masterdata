import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Types
type CommitStatus = 'pending' | 'ready' | 'approved' | 'rejected' | 'deployed'

interface CommitAction {
  action: 'approve' | 'reject' | 'deploy'
  comment?: string
}

// GET /api/commits/[commitId] - Get single commit with details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  const { commitId } = await params
  logger.info({ commitId }, 'GET /api/commits/[commitId]')
  
  try {
    // Mock commit detail with row changes
    const commit = {
      commit_id: commitId,
      commit_message: 'Q1 customer updates',
      status: 'pending' as CommitStatus,
      created_by: 'editor2',
      created_at: '2023-03-15T14:00:00Z',
      reviewed_by: null,
      reviewed_at: null,
      deployed_at: null,
      dbt_job_id: null,
      changes_summary: {
        inserts: 12,
        updates: 8,
        deletes: 2,
        entities: ['Customers'],
      },
      // Detailed changes for review
      changes: [
        {
          row_id: 'row-100',
          entity_name: 'Customers',
          change_type: 'INSERT',
          new_values: { customer_id: 1005, customer_name: 'New Customer Inc', email: 'new@customer.com' },
          old_values: null,
        },
        {
          row_id: 'row-101',
          entity_name: 'Customers',
          change_type: 'UPDATE',
          new_values: { email: 'updated@acme.com', phone: '+49 999 888777' },
          old_values: { email: 'old@acme.com', phone: '+49 111 222333' },
        },
        {
          row_id: 'row-102',
          entity_name: 'Customers',
          change_type: 'DELETE',
          new_values: null,
          old_values: { customer_id: 999, customer_name: 'Removed Customer' },
        },
      ],
      // Approval history
      history: [
        { timestamp: '2023-03-15T14:00:00Z', action: 'created', user: 'editor2', comment: null },
      ],
    }
    
    return NextResponse.json(commit)
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to fetch commit')
    return NextResponse.json(
      { error: 'Failed to fetch commit' },
      { status: 500 }
    )
  }
}

// PUT /api/commits/[commitId] - Update commit status (approve/reject/deploy)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  const { commitId } = await params
  logger.info({ commitId }, 'PUT /api/commits/[commitId]')
  
  try {
    const body = await request.json() as CommitAction
    const { action, comment } = body
    
    const validActions = ['approve', 'reject', 'deploy']
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      )
    }
    
    let newStatus: CommitStatus
    let additionalFields: Record<string, unknown> = {}
    
    switch (action) {
      case 'approve':
        newStatus = 'ready'
        additionalFields = {
          reviewed_by: 'admin', // TODO: Get from session
          reviewed_at: new Date().toISOString(),
        }
        break
      case 'reject':
        newStatus = 'rejected'
        additionalFields = {
          reviewed_by: 'admin',
          reviewed_at: new Date().toISOString(),
          rejection_comment: comment,
        }
        break
      case 'deploy':
        newStatus = 'deployed'
        additionalFields = {
          deployed_at: new Date().toISOString(),
          // Would trigger dbt job here
        }
        break
      default:
        newStatus = 'pending'
    }
    
    // TODO: Update in database
    // await execute(`
    //   UPDATE mds_meta.commit 
    //   SET status = @status, reviewed_by = @reviewed_by, reviewed_at = @reviewed_at
    //   WHERE commit_id = @commit_id
    // `, { commit_id: commitId, status: newStatus, ...additionalFields })
    
    return NextResponse.json({
      commit_id: commitId,
      status: newStatus,
      action,
      ...additionalFields,
    })
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to update commit')
    return NextResponse.json(
      { error: 'Failed to update commit' },
      { status: 500 }
    )
  }
}

// DELETE /api/commits/[commitId] - Cancel/delete pending commit
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  const { commitId } = await params
  logger.info({ commitId }, 'DELETE /api/commits/[commitId]')
  
  try {
    // Only allow deleting pending commits
    // TODO: Check status and delete from database
    
    return NextResponse.json({ 
      success: true,
      commit_id: commitId,
      message: 'Commit cancelled and rows returned to draft status'
    })
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to delete commit')
    return NextResponse.json(
      { error: 'Failed to delete commit' },
      { status: 500 }
    )
  }
}

// PATCH /api/commits/[commitId] - Update commit status directly
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ commitId: string }> }
) {
  const { commitId } = await params
  logger.info({ commitId }, 'PATCH /api/commits/[commitId]')
  
  try {
    const body = await request.json()
    const { status } = body
    
    const validStatuses = ['pending', 'approved', 'rejected', 'deployed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }
    
    // Determine which timestamp field to update
    let updateField = ''
    let updateBy = ''
    
    switch (status) {
      case 'approved':
        updateField = 'approved_at = GETUTCDATE(), approved_by = @user'
        updateBy = 'admin'
        break
      case 'rejected':
        updateField = 'rejected_at = GETUTCDATE(), rejected_by = @user'
        updateBy = 'admin'
        break
      case 'deployed':
        updateField = 'deployed_at = GETUTCDATE(), deployed_by = @user'
        updateBy = 'admin'
        break
      default:
        updateField = ''
    }
    
    // Update the commit status in the database
    const sql = `
      UPDATE mds_stage.[commit] 
      SET status = @status${updateField ? ', ' + updateField : ''}
      WHERE id = @commitId
    `
    
    await dbExecute(sql, { 
      commitId: parseInt(commitId), 
      status,
      user: updateBy 
    })
    
    logger.info({ commitId, status }, 'Commit status updated')
    
    return NextResponse.json({
      id: parseInt(commitId),
      status,
      updated: true
    })
  } catch (error) {
    logger.error({ error, commitId }, 'Failed to update commit')
    return NextResponse.json(
      { error: 'Failed to update commit', details: String(error) },
      { status: 500 }
    )
  }
}
