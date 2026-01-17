import { NextRequest, NextResponse } from 'next/server'
import { promoteJob } from '@/lib/queue/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/promote - Promote a paused/delayed job to start immediately
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const success = await promoteJob(id)

    if (!success) {
      return NextResponse.json(
        { error: 'Job not found or cannot be promoted (only delayed jobs can be promoted)' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Job ${id} wurde aktiviert und startet jetzt`,
    })
  } catch (error) {
    console.error('Failed to promote job:', error)
    return NextResponse.json(
      { error: 'Failed to promote job' },
      { status: 500 }
    )
  }
}
