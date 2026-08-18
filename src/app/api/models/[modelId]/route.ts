import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAdmin } from '@/lib/authz'
import { getModel, updateModel, deleteModel } from '@/lib/services/modelService'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models/[modelId] - Get single model
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  logger.info({ modelId }, 'GET /api/models/[modelId]')

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

  const authError = await requireAdmin()
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
