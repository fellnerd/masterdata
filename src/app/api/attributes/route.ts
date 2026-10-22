import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { listAttributes, createAttribute } from '@/lib/services/attributeService'
import { requireAccess, getVisibility, entityAllowed } from '@/lib/permissions'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/attributes - List all attributes
export async function GET(request: NextRequest) {
  logger.info('GET /api/attributes')

  const scope = await getVisibility('read')
  if (!scope.ok) return scope.response

  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')

    const result = await listAttributes(entityId ? parseInt(entityId) : undefined)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const results = result.data.filter(a => entityAllowed(scope.visibility, a.entity_id))
    const businessKeys = results.filter(a => a.is_business_key).length
    const references = results.filter(a => a.reference_entity_id !== null).length
    const entityCount = new Set(results.map(a => a.entity_id)).size

    return NextResponse.json({
      data: results,
      total: results.length,
      summary: {
        total: results.length,
        businessKeys,
        references,
        entities: entityCount
      }
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch attributes')
    return NextResponse.json(
      { error: 'Failed to fetch attributes', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/attributes - Create new attribute
export async function POST(request: NextRequest) {
  logger.info('POST /api/attributes')

  try {
    const body = await request.json()

    const denied = await requireAccess('schema', { entityId: Number(body?.entity_id) })
    if (denied) return denied

    const result = await createAttribute(body)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create attribute')
    return NextResponse.json(
      { error: 'Failed to create attribute', details: String(error) },
      { status: 500 }
    )
  }
}
