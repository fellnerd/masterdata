import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '@/lib/logger'
import { query, execute } from '@/lib/db'

// Types
interface DataRow {
  row_id: string
  entity_id: number
  status: 'DRAFT' | 'PENDING' | 'VALIDATED' | 'INVALID' | 'COMMITTED'
  created_by: string
  created_at: string
  business_key: string | null
  data: Record<string, unknown>
}

interface StagedRecordRow {
  id: number
  entity_id: number
  business_key: string
  business_key_hash: string
  status: string
  payload: string
  data: string
  created_by: string
  created_at: Date
  validation_errors: string | null
}

// GET /api/data/[entityId] - List data rows for entity from database
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  const entityIdNum = parseInt(entityId)
  logger.info({ entityId: entityIdNum }, 'GET /api/data/[entityId]')
  
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')
    const search = searchParams.get('search')
    const offset = (page - 1) * pageSize
    
    // Build WHERE clause
    let whereClause = 'WHERE entity_id = @entityId'
    if (status) {
      whereClause += ' AND status = @status'
    }
    if (search) {
      whereClause += ' AND (business_key LIKE @search OR payload LIKE @search)'
    }
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM mds_stage.staged_record 
      ${whereClause}
    `
    
    const countParams: Record<string, unknown> = { entityId: entityIdNum }
    if (status) countParams.status = status.toUpperCase()
    if (search) countParams.search = `%${search}%`
    
    const countResult = await query<{ total: number }>(countQuery, countParams)
    const total = countResult[0]?.total || 0
    
    // Get paginated data
    const dataQuery = `
      SELECT 
        id, entity_id, business_key, business_key_hash, status,
        payload, data, created_by, created_at, validation_errors
      FROM mds_stage.staged_record 
      ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `
    
    const dataParams: Record<string, unknown> = { 
      entityId: entityIdNum,
      offset,
      pageSize 
    }
    if (status) dataParams.status = status.toUpperCase()
    if (search) dataParams.search = `%${search}%`
    
    const rows = await query<StagedRecordRow>(dataQuery, dataParams)
    
    // Transform to API format
    const data: DataRow[] = rows.map(row => ({
      row_id: row.id.toString(),
      entity_id: row.entity_id,
      status: row.status as DataRow['status'],
      created_by: row.created_by || 'system',
      created_at: row.created_at?.toISOString() || new Date().toISOString(),
      business_key: row.business_key,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    }))
    
    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to fetch data')
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}

// POST /api/data/[entityId] - Create new data row(s)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  const entityIdNum = parseInt(entityId)
  logger.info({ entityId: entityIdNum }, 'POST /api/data/[entityId]')
  
  try {
    const body = await request.json()
    const { rows } = body // Can be single row or array
    
    const rowsToCreate = Array.isArray(rows) ? rows : [rows]
    const createdIds: number[] = []
    
    for (const rowData of rowsToCreate) {
      const payload = JSON.stringify(rowData)
      // Generate a simple hash for business key if not provided
      const businessKey = rowData.business_key || uuidv4()
      
      const insertQuery = `
        INSERT INTO mds_stage.staged_record 
          (entity_id, business_key, business_key_hash, payload, data, status, operation, source_system, created_by)
        OUTPUT INSERTED.id
        VALUES 
          (@entityId, @businessKey, CONVERT(CHAR(64), HASHBYTES('SHA2_256', @businessKey), 2), 
           @payload, @payload, 'DRAFT', 'INSERT', 'MDS_UI', 'admin')
      `
      
      const result = await query<{ id: number }>(insertQuery, {
        entityId: entityIdNum,
        businessKey,
        payload
      })
      
      if (result[0]) {
        createdIds.push(result[0].id)
      }
    }
    
    return NextResponse.json({
      data: createdIds.map(id => ({ row_id: id.toString() })),
      created: createdIds.length,
    }, { status: 201 })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to create data')
    return NextResponse.json(
      { error: 'Failed to create data' },
      { status: 500 }
    )
  }
}

// PUT /api/data/[entityId] - Batch update rows (for bulk status changes)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  const entityIdNum = parseInt(entityId)
  logger.info({ entityId: entityIdNum }, 'PUT /api/data/[entityId] (batch)')
  
  try {
    const body = await request.json()
    const { row_ids, status } = body
    
    if (!Array.isArray(row_ids) || row_ids.length === 0) {
      return NextResponse.json(
        { error: 'row_ids array is required' },
        { status: 400 }
      )
    }
    
    const validStatuses = ['DRAFT', 'PENDING', 'VALIDATED', 'INVALID', 'COMMITTED']
    const statusUpper = status.toUpperCase()
    if (!validStatuses.includes(statusUpper)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }
    
    // Build IN clause for IDs
    const idList = row_ids.map((id: string) => parseInt(id)).join(',')
    
    const updateQuery = `
      UPDATE mds_stage.staged_record 
      SET status = '${statusUpper}'
      WHERE id IN (${idList}) AND entity_id = @entityId
    `
    
    const updated = await execute(updateQuery, { entityId: entityIdNum })
    
    return NextResponse.json({
      success: true,
      updated,
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to update data')
    return NextResponse.json(
      { error: 'Failed to update data' },
      { status: 500 }
    )
  }
}

// DELETE /api/data/[entityId] - Batch delete rows
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  const entityIdNum = parseInt(entityId)
  logger.info({ entityId: entityIdNum }, 'DELETE /api/data/[entityId]')
  
  try {
    const body = await request.json()
    const { row_ids } = body
    
    if (!Array.isArray(row_ids) || row_ids.length === 0) {
      return NextResponse.json(
        { error: 'row_ids array is required' },
        { status: 400 }
      )
    }
    
    // Only allow deleting DRAFT rows
    const idList = row_ids.map((id: string) => parseInt(id)).join(',')
    
    const deleteQuery = `
      DELETE FROM mds_stage.staged_record 
      WHERE id IN (${idList}) AND entity_id = @entityId AND status = 'DRAFT'
    `
    
    const deleted = await execute(deleteQuery, { entityId: entityIdNum })
    
    return NextResponse.json({
      success: true,
      deleted,
      deleted_ids: row_ids,
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to delete data')
    return NextResponse.json(
      { error: 'Failed to delete data' },
      { status: 500 }
    )
  }
}
