import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { requireTokenAccess, getTokenVisibility, entityAllowed, modelAllowed } from '@/lib/permissions'
import { listModels, createModel } from '@/lib/services/modelService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/models - List data models (scope: entities:read)
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(request, 'entities:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const scope = await getTokenVisibility(auth.userId, 'read')
  if (!scope.ok) return scope.response

  try {
    const result = await listModels()
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const data = result.data.filter(m => modelAllowed(scope.visibility, m.id))
    return NextResponse.json({ data, total: data.length })
  } catch (error) {
    logger.error({ error }, 'v1/models GET failed')
    return NextResponse.json({ error: 'Failed to list models', details: String(error) }, { status: 500 })
  }
}

// POST /api/v1/models - Create a data model (scope: models:write, admin only)
export async function POST(request: NextRequest) {
  const auth = await verifyApiToken(request, 'models:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // creating a model is a system-level action (global admin, checked live)
  const adminError = await requireTokenAccess(auth.userId, 'system')
  if (adminError) return adminError

  try {
    const body = await request.json()
    const result = await createModel({ ...body, created_by: `token:${auth.userId}` })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    logger.error({ error }, 'v1/models POST failed')
    return NextResponse.json({ error: 'Failed to create model', details: String(error) }, { status: 500 })
  }
}
