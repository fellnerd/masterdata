import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StagedRecord {
  id: number
  commit_id: number | null
  entity_id: number
  operation: string
  business_key: string
  data: string
  status: string
}

// GET /api/v1/stage/records/[id] - Get a single staged record (scope: stage:read)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'stage:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params

  try {
    const records = await dbQuery<StagedRecord & { entity_code: string; entity_name: string }>(
      `SELECT r.*, e.code AS entity_code, e.name AS entity_name
       FROM mds_stage.staged_record r
       INNER JOIN mds_meta.entity e ON e.id = r.entity_id
       WHERE r.id = @id`,
      { id: parseInt(id) }
    )

    if (records.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    const record = records[0]
    return NextResponse.json({ ...record, data: record.data ? JSON.parse(record.data) : {} })
  } catch (error) {
    logger.error({ error, id }, 'v1/stage/records/[id] GET failed')
    return NextResponse.json({ error: 'Failed to fetch record', details: String(error) }, { status: 500 })
  }
}

// PUT /api/v1/stage/records/[id] - Update a staged record (scope: stage:write)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'stage:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const { data, operation } = body

    const currentRecords = await dbQuery<StagedRecord>(
      'SELECT * FROM mds_stage.staged_record WHERE id = @id',
      { id: parseInt(id) }
    )
    if (currentRecords.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }
    const current = currentRecords[0]

    const updates: string[] = []
    const queryParams: Record<string, unknown> = { id: parseInt(id) }

    // Same rule as the internal /api/records/[recordId] route: an edit on an
    // already-loaded record must clear commit_id, otherwise it can never be
    // picked up by a later "commit pending records" pass (which requires
    // commit_id IS NULL).
    if (current.status === 'loaded') {
      updates.push("operation = 'UPDATE'")
      updates.push("status = 'pending'")
      updates.push('commit_id = NULL')
      updates.push('previous_data = data')
    }

    if (data !== undefined) {
      const dataJson = JSON.stringify(data)
      updates.push('data = @data')
      updates.push('payload = @data')
      queryParams.data = dataJson

      const attributes = await dbQuery<{ code: string }>(
        'SELECT code FROM mds_meta.attribute WHERE entity_id = @entityId AND is_business_key = 1',
        { entityId: current.entity_id }
      )
      if (attributes.length > 0) {
        const newBusinessKey = data[attributes[0].code]
        if (newBusinessKey && newBusinessKey !== current.business_key) {
          updates.push('business_key = @businessKey')
          updates.push("business_key_hash = CONVERT(CHAR(64), HASHBYTES('SHA2_256', @businessKey), 2)")
          queryParams.businessKey = String(newBusinessKey)
        }
      }
    }

    if (operation !== undefined && current.status !== 'loaded') {
      updates.push('operation = @operation')
      queryParams.operation = operation
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    await dbExecute(`UPDATE mds_stage.staged_record SET ${updates.join(', ')} WHERE id = @id`, queryParams)

    return NextResponse.json({ record_id: id, updated_at: new Date().toISOString() })
  } catch (error) {
    logger.error({ error, id }, 'v1/stage/records/[id] PUT failed')
    return NextResponse.json({ error: 'Failed to update record', details: String(error) }, { status: 500 })
  }
}

// DELETE /api/v1/stage/records/[id] - Delete/soft-delete a staged record (scope: stage:write)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'stage:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params

  try {
    const currentRecords = await dbQuery<StagedRecord>(
      'SELECT * FROM mds_stage.staged_record WHERE id = @id',
      { id: parseInt(id) }
    )
    if (currentRecords.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }
    const current = currentRecords[0]

    if (current.status === 'pending') {
      await dbExecute('DELETE FROM mds_stage.staged_record WHERE id = @id', { id: parseInt(id) })
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

    // Already-loaded records: soft-delete via a DELETE operation, applied on next deploy
    await dbExecute(
      `UPDATE mds_stage.staged_record
       SET previous_data = data, operation = 'DELETE', status = 'pending', commit_id = NULL
       WHERE id = @id`,
      { id: parseInt(id) }
    )

    return NextResponse.json({
      success: true,
      action: 'delete_operation_set',
      message: `DELETE operation set for business key "${current.business_key}". Commit and deploy to apply.`,
    })
  } catch (error) {
    logger.error({ error, id }, 'v1/stage/records/[id] DELETE failed')
    return NextResponse.json({ error: 'Failed to delete record', details: String(error) }, { status: 500 })
  }
}
