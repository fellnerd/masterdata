import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { deployViews } from '@/lib/services/viewDeployService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Deploy Views API
 *
 * Generates and deploys SQL views based on view configuration.
 * Views are created in mds_view schema.
 */

// POST /api/views/deploy - Deploy (or redeploy) one or more views
//
// Default: plain JSON response, including the step-by-step `logs`.
// With ?stream=1 the same log lines are pushed live as Server-Sent Events
// (`{type:'log'|'progress'|'result'|'error'}`) - the Views page uses that to
// show a running log like the Jobs page does. text/event-stream (rather than
// ndjson) is deliberate: the reverse proxy in front of the app flushes SSE
// immediately, so lines show up as they happen instead of all at the end.
export async function POST(request: NextRequest) {
  logger.info('POST /api/views/deploy')

  try {
    const body = await request.json()
    const { view_ids, user = 'admin' } = body
    const stream = new URL(request.url).searchParams.get('stream') === '1'

    if (!view_ids || !Array.isArray(view_ids) || view_ids.length === 0) {
      return NextResponse.json(
        { error: 'view_ids array is required' },
        { status: 400 }
      )
    }

    const summarize = (results: Awaited<ReturnType<typeof deployViews>>) => {
      const successCount = results.filter(r => r.status === 'success').length
      return {
        views_processed: results.length,
        views_success: successCount,
        views_failed: results.length - successCount,
        results,
        message: successCount === results.length
          ? 'All views deployed successfully'
          : `${successCount} of ${results.length} views deployed successfully`
      }
    }

    if (!stream) {
      const logs: string[] = []
      const results = await deployViews(view_ids, user, { log: m => logs.push(m) })
      return NextResponse.json({ ...summarize(results), logs })
    }

    const encoder = new TextEncoder()
    const sse = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        try {
          const results = await deployViews(view_ids, user, {
            log: message => send({ type: 'log', message }),
            progress: value => send({ type: 'progress', value })
          })
          send({ type: 'result', ...summarize(results) })
        } catch (error) {
          logger.error({ error }, 'Failed to deploy views')
          send({ type: 'error', error: error instanceof Error ? error.message : 'Failed to deploy views' })
        } finally {
          controller.close()
        }
      }
    })

    return new Response(sse, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      }
    })
  } catch (error) {
    logger.error({ error }, 'Failed to deploy views')
    return NextResponse.json(
      { error: 'Failed to deploy views' },
      { status: 500 }
    )
  }
}

// GET /api/views/deploy - Get view deployment status
export async function GET(request: NextRequest) {
  logger.info('GET /api/views/deploy')
  
  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    
    let query = `
      SELECT 
        v.id,
        v.code,
        v.name,
        v.view_type,
        v.is_deployed,
        v.last_deployed_at,
        e.code as entity_code,
        e.name as entity_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.VIEWS 
          WHERE TABLE_SCHEMA = 'mds_view' AND TABLE_NAME = v.code
        ) THEN 1 ELSE 0 END AS view_exists
      FROM mds_meta.entity_view v
      JOIN mds_meta.entity e ON v.entity_id = e.id
    `
    
    const params: Record<string, unknown> = {}
    
    if (entityId) {
      query += ' WHERE v.entity_id = @entityId'
      params.entityId = parseInt(entityId)
    }
    
    query += ' ORDER BY e.name, v.name'
    
    const views = await dbQuery(query, params)
    
    return NextResponse.json({
      views,
      count: views.length
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to get deployment status')
    return NextResponse.json(
      { error: 'Failed to get deployment status' },
      { status: 500 }
    )
  }
}
