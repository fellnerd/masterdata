import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { reorderAttributes } from '@/lib/services/attributeService'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT /api/attributes/reorder - Body: { entity_id, order: [attributeId, ...] }
// (every attribute id of the entity, in the desired order)
export async function PUT(request: NextRequest) {
  logger.info('PUT /api/attributes/reorder')

  try {
    const { entity_id, order } = await request.json()
    if (!Number.isInteger(entity_id)) {
      return NextResponse.json({ error: 'entity_id (integer) is required' }, { status: 400 })
    }

    const result = await reorderAttributes(entity_id, order)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error }, 'Failed to reorder attributes')
    return NextResponse.json({ error: 'Failed to reorder attributes', details: String(error) }, { status: 500 })
  }
}
