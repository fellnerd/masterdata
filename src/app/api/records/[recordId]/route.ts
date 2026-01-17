import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StagedRecord {
  id: number
  commit_id: number
  entity_id: number
  operation: string
  business_key: string
  data: string
  status: string
}

// GET /api/records/[recordId] - Get single record
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await params
  logger.info({ recordId }, 'GET /api/records/[recordId]')
  
  try {
    const records = await dbQuery<StagedRecord>(
      `SELECT r.*, e.code AS entity_code, e.name AS entity_name
       FROM mds_stage.staged_record r
       INNER JOIN mds_meta.entity e ON e.id = r.entity_id
       WHERE r.id = @id`,
      { id: parseInt(recordId) }
    )
    
    if (records.length === 0) {
      return NextResponse.json(
        { error: 'Record not found' },
        { status: 404 }
      )
    }
    
    const record = records[0]
    return NextResponse.json({
      ...record,
      data: record.data ? JSON.parse(record.data) : {}
    })
  } catch (error) {
    logger.error({ error, recordId }, 'Failed to fetch record')
    return NextResponse.json(
      { error: 'Failed to fetch record' },
      { status: 500 }
    )
  }
}

// PUT /api/records/[recordId] - Update record
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await params
  logger.info({ recordId }, 'PUT /api/records/[recordId]')
  
  try {
    const body = await request.json()
    const { data, operation } = body
    
    // Get current record with entity info
    const currentRecords = await dbQuery<StagedRecord & { scd_type: string }>(
      `SELECT sr.*, e.scd_type 
       FROM mds_stage.staged_record sr
       JOIN mds_meta.entity e ON e.id = sr.entity_id
       WHERE sr.id = @id`,
      { id: parseInt(recordId) }
    )
    
    if (currentRecords.length === 0) {
      return NextResponse.json(
        { error: 'Record not found' },
        { status: 404 }
      )
    }
    
    const current = currentRecords[0]
    
    // Always update in-place - Data Entry shows the current state
    const updates: string[] = []
    const queryParams: Record<string, unknown> = { id: parseInt(recordId) }
    
    // If record was already deployed (loaded), change operation to UPDATE and reset to pending
    // This enables SCD2 historization when deployed to master
    // Also save previous_data so we can restore on reject
    if (current.status === 'loaded') {
      updates.push('operation = \'UPDATE\'')
      updates.push('status = \'pending\'')
      // Save current data as previous_data for potential reject rollback
      updates.push('previous_data = data')
      logger.info({ recordId, previousStatus: current.status }, 
        'Resetting deployed record to pending with UPDATE operation for SCD2')
    }
    
    if (data !== undefined) {
      const dataJson = JSON.stringify(data)
      updates.push('data = @data')
      updates.push('payload = @data')
      queryParams.data = dataJson
      
      // Update business_key if it's in the data
      const attributes = await dbQuery<{ code: string; is_business_key: boolean }>(
        `SELECT a.code, a.is_business_key 
         FROM mds_meta.attribute a
         WHERE a.entity_id = @entityId AND a.is_business_key = 1`,
        { entityId: current.entity_id }
      )
      
      if (attributes.length > 0) {
        const bkAttr = attributes[0]
        const newBusinessKey = data[bkAttr.code]
        if (newBusinessKey && newBusinessKey !== current.business_key) {
          updates.push('business_key = @businessKey')
          updates.push('business_key_hash = CONVERT(CHAR(64), HASHBYTES(\'SHA2_256\', @businessKey), 2)')
          queryParams.businessKey = String(newBusinessKey)
        }
      }
    }
    
    if (operation !== undefined && current.status !== 'loaded') {
      // Only allow explicit operation change if not already deployed
      updates.push('operation = @operation')
      queryParams.operation = operation
    }
    
    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }
    
    await dbExecute(
      `UPDATE mds_stage.staged_record SET ${updates.join(', ')} WHERE id = @id`,
      queryParams
    )
    
    return NextResponse.json({
      record_id: recordId,
      updated_at: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ error, recordId }, 'Failed to update record')
    return NextResponse.json(
      { error: 'Failed to update record', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/records/[recordId] - Delete record
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await params
  logger.info({ recordId }, 'DELETE /api/records/[recordId]')
  
  try {
    // Get current record with entity info
    const currentRecords = await dbQuery<StagedRecord & { scd_type: string }>(
      `SELECT sr.*, e.scd_type 
       FROM mds_stage.staged_record sr
       JOIN mds_meta.entity e ON e.id = sr.entity_id
       WHERE sr.id = @id`,
      { id: parseInt(recordId) }
    )
    
    if (currentRecords.length === 0) {
      return NextResponse.json(
        { error: 'Record not found' },
        { status: 404 }
      )
    }
    
    const current = currentRecords[0]
    
    // Pending records: Direct delete
    if (current.status === 'pending') {
      await dbExecute(
        'DELETE FROM mds_stage.staged_record WHERE id = @id',
        { id: parseInt(recordId) }
      )
      
      // Update commit record count if attached to commit
      if (current.commit_id) {
        await dbExecute(
          `UPDATE mds_stage.[commit] 
           SET record_count = (SELECT COUNT(*) FROM mds_stage.staged_record WHERE commit_id = @commitId)
           WHERE id = @commitId`,
          { commitId: current.commit_id }
        )
      }
      
      return NextResponse.json({ success: true, action: 'deleted' })
    }
    
    // Loaded records: Update in-place to DELETE operation (soft delete for master)
    // Same pattern as UPDATE - modify existing record, don't create new one
    // Save previous_data so we can restore on reject
    await dbExecute(
      `UPDATE mds_stage.staged_record 
       SET previous_data = data,
           operation = 'DELETE',
           status = 'pending',
           commit_id = NULL
       WHERE id = @id`,
      { id: parseInt(recordId) }
    )
    
    logger.info({ recordId, businessKey: current.business_key }, 'Set DELETE operation for loaded record')
    
    return NextResponse.json({ 
      success: true, 
      action: 'delete_operation_set',
      message: `DELETE operation set for business key "${current.business_key}". Commit and deploy to apply.`
    })
  } catch (error) {
    logger.error({ error, recordId }, 'Failed to delete record')
    return NextResponse.json(
      { error: 'Failed to delete record', details: String(error) },
      { status: 500 }
    )
  }
}
