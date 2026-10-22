import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getModel, updateModel, deleteModel } from '@/lib/services/modelService'
import { requireAccess, getVisibility, modelAllowed, entityAllowed } from '@/lib/permissions'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models/[modelId] - Get single model
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'GET /api/models/[modelId]')

  const scope = await getVisibility('read')
  if (!scope.ok) return scope.response
  if (!modelAllowed(scope.visibility, parseInt(modelId))) {
    return NextResponse.json({ error: 'Forbidden: no access to this model' }, { status: 403 })
  }

  try {
    const result = await getModel(parseInt(modelId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to fetch model')
    return NextResponse.json(
      { error: 'Failed to fetch model' },
      { status: 500 }
    )
  }
}

// PUT /api/models/[modelId] - Update model
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'PUT /api/models/[modelId]')

  const denied = await requireAccess('schema', { modelId: parseInt(modelId) })
  if (denied) return denied

  try {
    const body = await request.json()
    const result = await updateModel(parseInt(modelId), body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to update model')
    return NextResponse.json(
      { error: 'Failed to update model' },
      { status: 500 }
    )
  }
}

// DELETE /api/models/[modelId] - Delete model
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'DELETE /api/models/[modelId]')

  const authError = await requireAccess('system')
  if (authError) return authError

  try {
    const result = await deleteModel(parseInt(modelId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    logger.error({ error, modelId }, 'Failed to delete model')
    return NextResponse.json(
      { error: 'Failed to delete model' },
      { status: 500 }
    )
  }
}
