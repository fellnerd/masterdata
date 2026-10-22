import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireTokenAccess, getTokenVisibility, entityAllowed, modelAllowed, entityIdOfAttribute } from '@/lib/permissions'
import { getAttribute, updateAttribute, deleteAttribute } from '@/lib/services/attributeService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/attributes/[id] - Get a single attribute (scope: entities:read)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  const readDenied = await requireTokenAccess(auth.userId, 'read', { entityId: (await entityIdOfAttribute(parseInt(id))) ?? -1 })
  if (readDenied) return readDenied
  try {
    const result = await getAttribute(parseInt(id))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/attributes/[id] GET failed')
    return NextResponse.json({ error: 'Failed to fetch attribute', details: String(error) }, { status: 500 })
  }
}

// PUT /api/v1/attributes/[id] - Update an attribute (scope: attributes:write, admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'attributes:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { id } = await params
  const schemaDenied = await requireTokenAccess(auth.userId, 'schema', { entityId: (await entityIdOfAttribute(parseInt(id))) ?? -1 })
  if (schemaDenied) return schemaDenied
  try {
    const body = await request.json()
    const attributeId = parseInt(id)
    const result = await updateAttribute(attributeId, { ...body, updated_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    // v1 returns the full updated resource, not just {attribute_id, entity_id, updated_at}
    const full = await getAttribute(attributeId)
    if (!full.ok) {
      return NextResponse.json({ error: full.error }, { status: full.status })
    }
    return NextResponse.json(full.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/attributes/[id] PUT failed')
    return NextResponse.json({ error: 'Failed to update attribute', details: String(error) }, { status: 500 })
  }
}

// DELETE /api/v1/attributes/[id] - Delete an attribute (scope: attributes:write, admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'attributes:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { id } = await params
  const schemaDenied = await requireTokenAccess(auth.userId, 'schema', { entityId: (await entityIdOfAttribute(parseInt(id))) ?? -1 })
  if (schemaDenied) return schemaDenied
  try {
    const result = await deleteAttribute(parseInt(id))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/attributes/[id] DELETE failed')
    return NextResponse.json({ error: 'Failed to delete attribute', details: String(error) }, { status: 500 })
  }
}
