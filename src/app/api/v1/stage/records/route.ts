import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StagedRecord {
  id: number
  commit_id: number
  entity_id: number
  entity_code?: string
  entity_name?: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  business_key: string
  business_key_hash: string
  data: string
  previous_data: string | null
  status: string
  validation_errors: string | null
  created_at: string
  created_by: string
}

// GET /api/v1/stage/records - List staged records (scope: stage:read)
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'stage:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    const commitId = searchParams.get('commit_id')
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50'), 200)
    const offset = (page - 1) * pageSize

    let whereClause = 'WHERE 1=1'
    const params: Record<string, unknown> = {}

    if (entityId) {
      whereClause += ' AND r.entity_id = @entityId'
      params.entityId = parseInt(entityId)
    }
    if (commitId) {
      whereClause += ' AND r.commit_id = @commitId'
      params.commitId = parseInt(commitId)
    }
    if (status) {
      whereClause += ' AND r.status = @status'
      params.status = status
    }

    const countResult = await dbQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM mds_stage.staged_record r ${whereClause}`,
      params
    )
    const total = countResult[0]?.total || 0

    const results = await dbQuery<StagedRecord>(
      `SELECT r.id, r.commit_id, r.entity_id, e.code AS entity_code, e.name AS entity_name,
              r.operation, r.business_key, r.business_key_hash, r.data, r.previous_data,
              r.status, r.validation_errors, r.created_at, r.created_by
       FROM mds_stage.staged_record r
       INNER JOIN mds_meta.entity e ON e.id = r.entity_id
       ${whereClause}
       ORDER BY r.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize }
    )

    return NextResponse.json({
      data: results.map(r => ({
        ...r,
        data: r.data ? JSON.parse(r.data) : {},
        previous_data: r.previous_data ? JSON.parse(r.previous_data) : null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    logger.error({ error }, 'v1/stage/records GET failed')
    return NextResponse.json({ error: 'Failed to fetch records', details: String(error) }, { status: 500 })
  }
}

// POST /api/v1/stage/records - Create a staged record (scope: stage:write)
export async function POST(request: NextRequest) {
  const auth = await verifyApiToken(request, 'stage:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { entity_id, operation = 'INSERT', business_key: providedBusinessKey, data } = body

    if (!entity_id || !data) {
      return NextResponse.json({ error: 'entity_id and data are required' }, { status: 400 })
    }

    const entity = await dbQuery<{ id: number; code: string }>(
      'SELECT id, code FROM mds_meta.entity WHERE id = @entityId',
      { entityId: entity_id }
    )
    if (entity.length === 0) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    const bkAttribute = await dbQuery<{ code: string }>(
      'SELECT code FROM mds_meta.attribute WHERE entity_id = @entityId AND is_business_key = 1',
      { entityId: entity_id }
    )

    let business_key = providedBusinessKey
    if (business_key === undefined && bkAttribute.length > 0) {
      business_key = data[bkAttribute[0].code]
    }
    // Falsy-but-valid values (0, false) must not be treated as "missing" -
    // check explicitly for absence instead of `!business_key`.
    if (business_key === undefined || business_key === null || business_key === '') {
      return NextResponse.json(
        { error: 'business_key is required (either directly or in data with a business key attribute)' },
        { status: 400 }
      )
    }
    // HASHBYTES() only accepts char/varchar/binary types. mssql infers the
    // SQL parameter type from the JS value's type with no explicit typing
    // here (see db-server.ts), so a business key derived from a numeric
    // attribute (e.g. an integer business key) would otherwise be bound as
    // `int` and fail with "Argument data type int is invalid for argument 2
    // of hashbytes function." String-typed business keys never hit this,
    // which is why the bug only shows up for numeric business-key attributes.
    business_key = String(business_key)

    const dataJson = JSON.stringify(data)

    await dbExecute(
      `INSERT INTO mds_stage.staged_record
        (entity_id, operation, business_key, business_key_hash, payload, data, status, created_by)
       VALUES (
         @entityId, @operation, @businessKey,
         CONVERT(CHAR(64), HASHBYTES('SHA2_256', @businessKey), 2),
         @data, @data, 'pending', @user
       )`,
      { entityId: entity_id, operation, businessKey: business_key, data: dataJson, user: `api-token:${auth.userId}` }
    )

    const created = await dbQuery<StagedRecord>(
      `SELECT TOP 1 r.*, e.code AS entity_code, e.name AS entity_name
       FROM mds_stage.staged_record r
       INNER JOIN mds_meta.entity e ON e.id = r.entity_id
       WHERE r.entity_id = @entityId AND r.business_key = @businessKey
       ORDER BY r.id DESC`,
      { entityId: entity_id, businessKey: business_key }
    )

    return NextResponse.json(
      {
        ...created[0],
        data: JSON.parse(created[0].data),
        previous_data: created[0].previous_data ? JSON.parse(created[0].previous_data) : null,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error({ error }, 'v1/stage/records POST failed')
    return NextResponse.json({ error: 'Failed to create record', details: String(error) }, { status: 500 })
  }
}
