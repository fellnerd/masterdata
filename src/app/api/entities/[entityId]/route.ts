import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAdmin } from '@/lib/authz'
import { getEntity, updateEntity, deleteEntity } from '@/lib/services/entityService'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/entities/[entityId] - Get single entity with attributes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'GET /api/entities/[entityId]')

  try {
    const result = await getEntity(parseInt(entityId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to fetch entity')
    return NextResponse.json(
      { error: 'Failed to fetch entity' },
      { status: 500 }
    )
  }
}

// PUT /api/entities/[entityId] - Update entity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'PUT /api/entities/[entityId]')

  try {
    const body = await request.json()
    const result = await updateEntity(parseInt(entityId), body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to update entity')
    return NextResponse.json(
      { error: 'Failed to update entity' },
      { status: 500 }
    )
  }
}

// DELETE /api/entities/[entityId] - Delete entity
//
// Only genuinely *outstanding* work blocks deletion - see entityService's
// deleteEntity() for the full cascade/guard-check logic, shared with the
// v1 API.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'DELETE /api/entities/[entityId]')

  const authError = await requireAdmin()
  if (authError) return authError

  try {
    const result = await deleteEntity(parseInt(entityId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to delete entity')
    return NextResponse.json(
      { error: 'Failed to delete entity' },
      { status: 500 }
    )
  }
}
