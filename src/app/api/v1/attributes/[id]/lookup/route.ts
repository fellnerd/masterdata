import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireTokenAccess, entityIdOfAttribute } from '@/lib/permissions'
import { lookupReferenceOptions } from '@/lib/services/referenceLookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/attributes/{id}/lookup?parent_value=&q=&limit= - the choices of a reference
// attribute as { business_key, label } (scope: entities:read). Works for whoever may read
// the attribute's own entity, even when the referenced entity lives in a model they cannot
// read - only the key and the display field are returned. For a cascade child pass the
// parent attribute's current value as parent_value.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  try {
    const attributeId = parseInt(id)
    const denied = await requireTokenAccess(auth.userId, 'read', { entityId: (await entityIdOfAttribute(attributeId)) ?? -1 })
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const result = await lookupReferenceOptions(attributeId, {
      parentValue: searchParams.get('parent_value'),
      query: searchParams.get('q'),
      limit: parseInt(searchParams.get('limit') ?? '') || undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ data: result.data.data, total: result.data.total })
  } catch (error) {
    logger.error({ error, id }, 'v1/attributes/[id]/lookup GET failed')
    return NextResponse.json({ error: 'Failed to load the choices', details: String(error) }, { status: 500 })
  }
}
