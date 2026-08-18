import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireAdminForToken } from '@/lib/authz'
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
  const adminError = await requireAdminForToken(auth.userId)
  if (adminError) return adminError

  const { code } = await params
  try {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveEntityId(code, searchParams.get('model_code') || undefined)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const body = await request.json()
    const result = await updateEntity(resolved.data, { ...body, updated_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
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
  const adminError = await requireAdminForToken(auth.userId)
  if (adminError) return adminError

  const { code } = await params
  try {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveEntityId(code, searchParams.get('model_code') || undefined)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

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
