import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireTokenAccess, getTokenVisibility, entityAllowed, modelAllowed, entityIdOfAttribute } from '@/lib/permissions'
import { reorderAttributes } from '@/lib/services/attributeService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PUT /api/v1/attributes/reorder - Set the order of an entity's attributes
// (scope: attributes:write, admin only). Body: { entity_id, order: [attributeId, ...] }
// with every attribute id of the entity exactly once, in the desired order.
export async function PUT(request: NextRequest) {
  const auth = await verifyApiToken(request, 'attributes:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { entity_id, order } = await request.json()
    if (!Number.isInteger(entity_id)) {
      return NextResponse.json({ error: 'entity_id (integer) is required' }, { status: 400 })
    }

    const schemaDenied = await requireTokenAccess(auth.userId, 'schema', { entityId: entity_id })
    if (schemaDenied) return schemaDenied

    const result = await reorderAttributes(entity_id, order, `token:${auth.userId}`)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error }, 'v1/attributes/reorder PUT failed')
    return NextResponse.json({ error: 'Failed to reorder attributes', details: String(error) }, { status: 500 })
  }
}
