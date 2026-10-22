import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAccess, entityIdOfAttribute } from '@/lib/permissions'
import { lookupReferenceOptions } from '@/lib/services/referenceLookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-lookup?attribute_id=&parent_value=&q= - the choices of a reference
// attribute (business key + label). Allowed for whoever may read the attribute's OWN
// entity, so a form can offer values of an entity in another model without exposing it.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const attributeId = parseInt(searchParams.get('attribute_id') ?? '')
    if (!Number.isInteger(attributeId)) {
      return NextResponse.json({ error: 'attribute_id is required' }, { status: 400 })
    }

    const denied = await requireAccess('read', { entityId: (await entityIdOfAttribute(attributeId)) ?? -1 })
    if (denied) return denied

    const result = await lookupReferenceOptions(attributeId, {
      parentValue: searchParams.get('parent_value'),
      query: searchParams.get('q'),
      limit: parseInt(searchParams.get('limit') ?? '') || undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ data: result.data.data, total: result.data.total })
  } catch (error) {
    logger.error({ error }, 'GET /api/reference-lookup failed')
    return NextResponse.json({ error: 'Failed to load the choices', details: String(error) }, { status: 500 })
  }
}
