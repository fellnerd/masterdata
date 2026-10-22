import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { recordAudit } from '@/lib/permissions/audit'
import { requireTokenAccess, getTokenVisibility, entityAllowed } from '@/lib/permissions'
import { resolveEntityId, getEntity, updateEntity, deleteEntity } from '@/lib/services/entityService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/entities/[code] - Get a single entity + its attributes
// (scope: entities:read). [code] accepts either a numeric entity id or the
// entity's code; codes are only unique per-model, so pass ?model_code= to
// disambiguate if the code exists in more than one model (409 otherwise).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { code } = await params
  try {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveEntityId(code, searchParams.get('model_code') || undefined)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const denied = await requireTokenAccess(auth.userId, 'read', { entityId: resolved.data })
    if (denied) return denied

    const result = await getEntity(resolved.data)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, code }, 'v1/entities/[code] GET failed')
    return NextResponse.json({ error: 'Failed to fetch entity', details: String(error) }, { status: 500 })
  }
}

// PUT /api/v1/entities/[code] - Update an entity (scope: entities:write, admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await verifyApiToken(request, 'entities:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { code } = await params
  try {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveEntityId(code, searchParams.get('model_code') || undefined)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const denied = await requireTokenAccess(auth.userId, 'schema', { entityId: resolved.data })
    if (denied) return denied

    const body = await request.json()

    // sharing an entity with everyone is a system-level decision (global admin)
    if (body?.is_shared !== undefined) {
      const sharingDenied = await requireTokenAccess(auth.userId, 'system')
      if (sharingDenied) return sharingDenied
    }

    const result = await updateEntity(resolved.data, { ...body, updated_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (body?.is_shared !== undefined) {
      await recordAudit({
        actor: `token:${auth.userId}`,
        action: body.is_shared ? 'entity_share' : 'entity_unshare',
        subject: `entity #${resolved.data}`,
        detail: body.is_shared ? 'readable by every user with any permission' : 'no longer shared',
      })
    }

    // v1 returns the full updated resource, not just {entity_id, updated_at}
    const full = await getEntity(resolved.data)
    if (!full.ok) {
      return NextResponse.json({ error: full.error }, { status: full.status })
    }
    return NextResponse.json(full.data)
  } catch (error) {
    logger.error({ error, code }, 'v1/entities/[code] PUT failed')
    return NextResponse.json({ error: 'Failed to update entity', details: String(error) }, { status: 500 })
  }
}

// DELETE /api/v1/entities/[code] - Delete an entity (scope: entities:write, admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await verifyApiToken(request, 'entities:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { code } = await params
  try {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveEntityId(code, searchParams.get('model_code') || undefined)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const denied = await requireTokenAccess(auth.userId, 'schema', { entityId: resolved.data })
    if (denied) return denied

    const result = await deleteEntity(resolved.data)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, code }, 'v1/entities/[code] DELETE failed')
    return NextResponse.json({ error: 'Failed to delete entity', details: String(error) }, { status: 500 })
  }
}
