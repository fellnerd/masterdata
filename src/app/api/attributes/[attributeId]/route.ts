import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getAttribute, updateAttribute, deleteAttribute } from '@/lib/services/attributeService'
import { requireAccess, entityIdOfAttribute } from '@/lib/permissions'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/attributes/[attributeId] - Get single attribute
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'GET /api/attributes/[attributeId]')

  const denied = await requireAccess('read', { entityId: (await entityIdOfAttribute(parseInt(attributeId))) ?? -1 })
  if (denied) return denied

  try {
    const result = await getAttribute(parseInt(attributeId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to fetch attribute')
    return NextResponse.json(
      { error: 'Failed to fetch attribute' },
      { status: 500 }
    )
  }
}

// PUT /api/attributes/[attributeId] - Update attribute
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'PUT /api/attributes/[attributeId]')

  const denied = await requireAccess('schema', { entityId: (await entityIdOfAttribute(parseInt(attributeId))) ?? -1 })
  if (denied) return denied

  try {
    const body = await request.json()
    const result = await updateAttribute(parseInt(attributeId), body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to update attribute')
    return NextResponse.json(
      { error: 'Failed to update attribute' },
      { status: 500 }
    )
  }
}

// DELETE /api/attributes/[attributeId] - Delete attribute
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const { attributeId } = await params
  logger.info({ attributeId }, 'DELETE /api/attributes/[attributeId]')

  const authError = await requireAccess('schema', { entityId: (await entityIdOfAttribute(parseInt(attributeId))) ?? -1 })
  if (authError) return authError

  try {
    const result = await deleteAttribute(parseInt(attributeId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, attributeId }, 'Failed to delete attribute')
    return NextResponse.json(
      { error: 'Failed to delete attribute' },
      { status: 500 }
    )
  }
}
