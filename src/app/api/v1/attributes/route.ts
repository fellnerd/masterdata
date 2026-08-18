import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireAdminForToken } from '@/lib/authz'
import { listAttributes, createAttribute } from '@/lib/services/attributeService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/attributes?entity_id=<id> - List an entity's attributes
// (scope: entities:read - attributes are already exposed embedded in
// GET /api/v1/entities under this same scope, so a separate read scope
// would just create inconsistency). entity_id is required since attribute
// codes are entity-scoped.
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const entityId = searchParams.get('entity_id')
  if (!entityId) {
    return NextResponse.json({ error: 'entity_id query parameter is required' }, { status: 400 })
  }

  try {
    const result = await listAttributes(parseInt(entityId))
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ data: result.data, total: result.data.length })
  } catch (error) {
    logger.error({ error }, 'v1/attributes GET failed')
    return NextResponse.json({ error: 'Failed to list attributes', details: String(error) }, { status: 500 })
  }
}

// POST /api/v1/attributes - Create an attribute (scope: attributes:write, admin only)
export async function POST(request: NextRequest) {
  const auth = await verifyApiToken(request, 'attributes:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const adminError = await requireAdminForToken(auth.userId)
  if (adminError) return adminError

  try {
    const body = await request.json()
    const result = await createAttribute({ ...body, created_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'v1/attributes POST failed')
    return NextResponse.json({ error: 'Failed to create attribute', details: String(error) }, { status: 500 })
  }
}
