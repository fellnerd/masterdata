/**
 * Jobs API Route
 * 
 * GET /api/jobs - Liste aller Jobs
 * POST /api/jobs - Neuen Job erstellen
 * DELETE /api/jobs/:id - Job abbrechen
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { addJob, getQueueStats, getRecentJobs, cancelJob } from '@/lib/queue';
import type { JobType } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs
 * Holt Jobs mit Statistiken und Liste
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    const [stats, jobs] = await Promise.all([
      getQueueStats(),
      getRecentJobs(limit + 1), // Fetch one extra to check if there are more
    ]);

    // Check if there are more jobs
    const hasMore = jobs.length > limit;
    const returnedJobs = hasMore ? jobs.slice(0, limit) : jobs;

    return NextResponse.json({
      stats,
      jobs: returnedJobs,
      hasMore,
      total: stats.total,
    });
  } catch (error) {
    console.error('Failed to get jobs:', error);
    
    // Return empty state on Redis errors (e.g., rate limit)
    const isRateLimitError = error instanceof Error && 
      error.message?.includes('max requests limit exceeded');
    
    if (isRateLimitError) {
      return NextResponse.json({
        stats: { active: 0, waiting: 0, completed: 0, failed: 0, total: 0 },
        jobs: [],
        hasMore: false,
        total: 0,
        warning: 'Redis rate limit exceeded - showing empty state',
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to get jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs
 * Erstellt einen neuen Job
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, target, params, scheduled } = body;

    // Validate job type
    const validTypes: JobType[] = ['dbt-run', 'dbt-test', 'validate', 'deploy', 'import', 'export', 'schema-deploy'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid job type: ${type}` },
        { status: 400 }
      );
    }

    // Add job to queue (paused if scheduled=true)
    const job = await addJob(
      type,
      target || '*',
      session.user?.id || 'unknown',
      session.user?.name || 'Unknown User',
      params,
      { paused: scheduled === true }
    );

    return NextResponse.json({
      success: true,
      job,
      scheduled: scheduled === true,
    });
  } catch (error) {
    console.error('Failed to create job:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs?id=xxx
 * Bricht einen Job ab
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('id');

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID required' },
        { status: 400 }
      );
    }

    const cancelled = await cancelJob(jobId);

    if (cancelled) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: 'Cannot cancel job (may be already running or completed)' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Failed to cancel job:', error);
    return NextResponse.json(
      { error: 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
