import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/models - List data models (scope: entities:read)
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const models = await dbQuery<{
      id: number
      code: string
      name: string
      description: string | null
      status: string
      entity_count: number
    }>(
      `SELECT m.id, m.code, m.name, m.description, m.status,
              (SELECT COUNT(*) FROM mds_meta.entity e WHERE e.model_id = m.id) AS entity_count
       FROM mds_meta.model m
       ORDER BY m.name`
    )

    return NextResponse.json({ data: models, total: models.length })
  } catch (error) {
    logger.error({ error }, 'v1/models GET failed')
    return NextResponse.json({ error: 'Failed to list models', details: String(error) }, { status: 500 })
  }
}
