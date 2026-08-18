import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { verifyApiToken } from '@/lib/apiToken'
import { addJob } from '@/lib/queue/queue'
import { resolveEntityId } from '@/lib/services/entityService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/v1/entities/{code}/import - Trigger a Data Vault import for this
// entity (scope: stage:write). Runs asynchronously via the same 'import' job
// type as the Jobs page's manual trigger and scheduled imports - the entity
// must already have an import source configured (Settings/Entities -> Import
// Config; import_source_object, optionally import_column_mapping/import_filter).
// The import replaces this entity's staged records with a fresh full pull
// from the configured Data Vault source.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await verifyApiToken(request, 'stage:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { code } = await params

  try {
    const { searchParams } = new URL(request.url)
    const modelCode = searchParams.get('model_code') || undefined

    // entity.code is only unique per-model, not globally - resolveEntityId
    // returns 409 if the code is ambiguous across models without model_code.
    const resolved = await resolveEntityId(code, modelCode)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const entities = await dbQuery<{ id: number; code: string; import_source_object: string | null }>(
      'SELECT id, code, import_source_object FROM mds_meta.entity WHERE id = @id',
      { id: resolved.data }
    )

    const entity = entities[0]
    if (!entity.import_source_object) {
      return NextResponse.json(
        { error: 'Entity has no import source configured. Set one under Entities -> Import Config first.' },
        { status: 400 }
      )
    }

    const job = await addJob(
      'import',
      entity.code,
      String(auth.userId),
      `api-token:${auth.userId}`,
      { entity_id: entity.id }
    )

    logger.info({ entityId: entity.id, code, jobId: job.id, userId: auth.userId }, 'v1 import trigger')

    return NextResponse.json({
      success: true,
      job_id: job.id,
      entity_code: entity.code,
      source: entity.import_source_object,
    }, { status: 202 })
  } catch (error) {
    logger.error({ error, code }, 'v1/entities/[code]/import POST failed')
    return NextResponse.json({ error: 'Failed to trigger import', details: String(error) }, { status: 500 })
  }
}
