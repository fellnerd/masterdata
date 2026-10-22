import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getEntity, updateEntity, deleteEntity } from '@/lib/services/entityService'
import { recordAudit } from '@/lib/permissions/audit'
import { principalFromSession, requireAccess, getVisibility, modelAllowed, entityAllowed } from '@/lib/permissions'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/entities/[entityId] - Get single entity with attributes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'GET /api/entities/[entityId]')

  const denied = await requireAccess('read', { entityId: parseInt(entityId) })
  if (denied) return denied

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

  const denied = await requireAccess('schema', { entityId: parseInt(entityId) })
  if (denied) return denied

  try {
    const body = await request.json()

    // sharing an entity with everyone is a system-level decision (global admin)
    if (body?.is_shared !== undefined) {
      const sharingDenied = await requireAccess('system')
      if (sharingDenied) return sharingDenied
    }

    const result = await updateEntity(parseInt(entityId), body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (body?.is_shared !== undefined) {
      await recordAudit({
        actor: (await principalFromSession())?.email,
        action: body.is_shared ? 'entity_share' : 'entity_unshare',
        subject: `entity #${entityId}`,
        detail: body.is_shared ? 'readable by every user with any permission' : 'no longer shared',
      })
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

  const authError = await requireAccess('schema', { entityId: parseInt(entityId) })
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
