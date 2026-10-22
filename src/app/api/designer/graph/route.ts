import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { loadDesignerGraph } from '@/lib/designer/loadGraph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/designer/graph - models, entities (with their attributes) and the
// references between them, derived live from mds_meta for the Designer page.
export async function GET() {
  try {
    const graph = await loadDesignerGraph()
    return NextResponse.json(graph)
  } catch (error) {
    logger.error({ error }, 'GET /api/designer/graph failed')
    return NextResponse.json({ error: 'Failed to load the model graph', details: String(error) }, { status: 500 })
  }
}
