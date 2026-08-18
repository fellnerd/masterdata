import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireAdminForToken } from '@/lib/authz'
import { getModel, updateModel, deleteModel } from '@/lib/services/modelService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/models/[id] - Get a single model (scope: entities:read)
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
    const result = await getModel(parseInt(id))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/models/[id] GET failed')
    return NextResponse.json({ error: 'Failed to fetch model', details: String(error) }, { status: 500 })
  }
}

// PUT /api/v1/models/[id] - Update a model (scope: models:write, admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'models:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const adminError = await requireAdminForToken(auth.userId)
  if (adminError) return adminError

  const { id } = await params
  try {
    const body = await request.json()
    const modelId = parseInt(id)
    const result = await updateModel(modelId, { ...body, updated_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    // v1 returns the full updated resource, not just {model_id, updated_at}
    const full = await getModel(modelId)
    if (!full.ok) {
      return NextResponse.json({ error: full.error }, { status: full.status })
    }
    return NextResponse.json(full.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/models/[id] PUT failed')
    return NextResponse.json({ error: 'Failed to update model', details: String(error) }, { status: 500 })
  }
}

// DELETE /api/v1/models/[id] - Delete a model (scope: models:write, admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyApiToken(request, 'models:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const adminError = await requireAdminForToken(auth.userId)
  if (adminError) return adminError

  const { id } = await params
  try {
    const result = await deleteModel(parseInt(id))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, id }, 'v1/models/[id] DELETE failed')
    return NextResponse.json({ error: 'Failed to delete model', details: String(error) }, { status: 500 })
  }
}
