import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { listEntities, createEntity } from '@/lib/services/entityService'

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/entities - List all entities
export async function GET(request: NextRequest) {
  logger.info('GET /api/entities')

  try {
    const { searchParams } = new URL(request.url)
    const modelId = searchParams.get('model_id')

    const result = await listEntities(modelId ? parseInt(modelId) : undefined)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ data: result.data, total: result.data.length })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch entities')
    return NextResponse.json(
      { error: 'Failed to fetch entities', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/entities - Create new entity
export async function POST(request: NextRequest) {
  logger.info('POST /api/entities')

  try {
    const body = await request.json()
    const result = await createEntity(body)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'Failed to create entity')
    return NextResponse.json(
      { error: 'Failed to create entity', details: String(error) },
      { status: 500 }
    )
  }
}
