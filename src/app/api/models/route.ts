import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { listModels, createModel } from '@/lib/services/modelService'

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models - List all models
export async function GET() {
  logger.info('GET /api/models')

  try {
    const result = await listModels()
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ data: result.data, total: result.data.length })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch models')
    return NextResponse.json(
      { error: 'Failed to fetch models', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/models - Create new model
export async function POST(request: NextRequest) {
  logger.info('POST /api/models')

  try {
    const body = await request.json()
    const result = await createModel(body)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create model')
    return NextResponse.json(
      { error: 'Failed to create model', details: String(error) },
      { status: 500 }
    )
  }
}
