import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface EntityRow {
  id: number
  code: string
  name: string
  description: string | null
  status: string
  scd_type: string
  model_id: number
  model_code: string
  model_name: string
}

interface AttributeRow {
  entity_id: number
  code: string
  name: string
  data_type: string
  max_length: number | null
  is_required: boolean
  is_business_key: boolean
}

// GET /api/v1/entities - List entities with their attributes (scope: entities:read)
// Filter with ?model_id= or ?model_code=. Attributes are embedded inline
// since staging a record (POST /api/v1/stage/records) needs entity_id and
// attribute codes up front - this is the only way to discover those via API.
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const modelId = searchParams.get('model_id')
    const modelCode = searchParams.get('model_code')

    let where = 'WHERE 1=1'
    const params: Record<string, unknown> = {}
    if (modelId) {
      where += ' AND e.model_id = @modelId'
      params.modelId = parseInt(modelId)
    }
    if (modelCode) {
      where += ' AND m.code = @modelCode'
      params.modelCode = modelCode
    }

    const entities = await dbQuery<EntityRow>(
      `SELECT e.id, e.code, e.name, e.description, e.status, e.scd_type,
              e.model_id, m.code AS model_code, m.name AS model_name
       FROM mds_meta.entity e
       INNER JOIN mds_meta.model m ON m.id = e.model_id
       ${where}
       ORDER BY m.name, e.name`,
      params
    )

    if (entities.length === 0) {
      return NextResponse.json({ data: [], total: 0 })
    }

    const entityIds = entities.map(e => e.id)
    const placeholders = entityIds.map((_, i) => `@id${i}`).join(', ')
    const idParams: Record<string, number> = {}
    entityIds.forEach((id, i) => { idParams[`id${i}`] = id })

    const attributes = await dbQuery<AttributeRow>(
      `SELECT entity_id, code, name, data_type, max_length, is_required, is_business_key
       FROM mds_meta.attribute
       WHERE entity_id IN (${placeholders})
       ORDER BY entity_id, sort_order`,
      idParams
    )

    const attributesByEntity = new Map<number, AttributeRow[]>()
    for (const attr of attributes) {
      const list = attributesByEntity.get(attr.entity_id) ?? []
      list.push(attr)
      attributesByEntity.set(attr.entity_id, list)
    }

    const data = entities.map(e => ({
      ...e,
      attributes: (attributesByEntity.get(e.id) ?? []).map(({ entity_id: _entity_id, ...attr }) => attr),
    }))

    return NextResponse.json({ data, total: data.length })
  } catch (error) {
    logger.error({ error }, 'v1/entities GET failed')
    return NextResponse.json({ error: 'Failed to list entities', details: String(error) }, { status: 500 })
  }
}
