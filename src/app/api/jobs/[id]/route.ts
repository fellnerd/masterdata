/**
 * Single Job API Route
 * 
 * GET /api/jobs/[id] - Einzelnen Job abrufen
 * POST /api/jobs/[id]/retry - Job erneut ausführen
 * DELETE /api/jobs/[id] - Job abbrechen/entfernen
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMdsQueue } from '@/lib/queue/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: 'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress: number;
  attemptsMade: number;
  attemptsTotal: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  failedReason: string | null;
  returnValue: unknown;
  logs: string[];
  timeline: Array<{
    event: string;
    timestamp: string;
    details?: string;
  }>;
}

/**
 * GET /api/jobs/[id]
 * Holt Details eines einzelnen Jobs
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const queue = getMdsQueue();
    
    // Job in allen Zuständen suchen
    const job = await queue.getJob(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Status bestimmen
    const state = await job.getState();
    
    // Timeline erstellen
    const timeline: JobDetails['timeline'] = [];
    
    if (job.timestamp) {
      timeline.push({
        event: 'created',
        timestamp: new Date(job.timestamp).toISOString(),
        details: `Job "${job.name}" erstellt`
      });
    }
    
    if (job.processedOn) {
      timeline.push({
        event: 'started',
        timestamp: new Date(job.processedOn).toISOString(),
        details: 'Verarbeitung gestartet'
      });
    }
    
    if (job.finishedOn) {
      const isSuccess = state === 'completed';
      timeline.push({
        event: isSuccess ? 'completed' : 'failed',
        timestamp: new Date(job.finishedOn).toISOString(),
        details: isSuccess 
          ? 'Erfolgreich abgeschlossen' 
          : `Fehlgeschlagen: ${job.failedReason || 'Unbekannter Fehler'}`
      });
    }

    // Logs aus Progress extrahieren
    const progress = job.progress as { logs?: string[]; percent?: number; message?: string } | number;
    const logs = typeof progress === 'object' && progress?.logs ? progress.logs : [];
    const progressPercent = typeof progress === 'object' ? (progress?.percent ?? 0) : (typeof progress === 'number' ? progress : 0);

    // Duration berechnen
    let duration: number | null = null;
    if (job.processedOn && job.finishedOn) {
      duration = job.finishedOn - job.processedOn;
    } else if (job.processedOn && state === 'active') {
      duration = Date.now() - job.processedOn;
    }

    const jobDetails: JobDetails = {
      id: job.id || id,
      name: job.name,
      data: job.data as unknown as Record<string, unknown>,
      status: state as JobDetails['status'],
      progress: progressPercent,
      attemptsMade: job.attemptsMade,
      attemptsTotal: job.opts?.attempts || 3,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : new Date().toISOString(),
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      duration,
      failedReason: job.failedReason || null,
      returnValue: job.returnvalue,
      logs,
      timeline: timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    };

    return NextResponse.json(jobDetails);
  } catch (error) {
    console.error('Failed to get job:', error);
    return NextResponse.json(
      { error: 'Failed to get job details' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/[id]
 * Job erneut ausführen (via query param action=retry oder action=rerun)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    const queue = getMdsQueue();
    const job = await queue.getJob(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (action === 'retry') {
      const state = await job.getState();
      if (state !== 'failed') {
        return NextResponse.json(
          { error: 'Only failed jobs can be retried' },
          { status: 400 }
        );
      }
      
      await job.retry();
      return NextResponse.json({ success: true, message: 'Job queued for retry' });
    }

    if (action === 'rerun') {
      // Create a new job with the same data
      const newJob = await queue.add(job.name, job.data, {
        priority: job.opts?.priority,
      });
      
      // Remove the old job after creating the new one
      await job.remove();
      
      return NextResponse.json({ 
        success: true, 
        message: 'Job neu gestartet',
        jobId: newJob.id,
        removedJobId: id
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Failed to perform job action:', error);
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs/[id]
 * Job abbrechen oder entfernen
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const queue = getMdsQueue();
    const job = await queue.getJob(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const state = await job.getState();
    
    // Aktive Jobs können nicht gelöscht werden, nur abgebrochen
    if (state === 'active') {
      await job.moveToFailed(new Error('Cancelled by user'), 'user-cancelled');
      return NextResponse.json({ success: true, message: 'Job cancelled' });
    }
    
    // Andere Jobs können entfernt werden
    await job.remove();
    return NextResponse.json({ success: true, message: 'Job removed' });
  } catch (error) {
    console.error('Failed to delete job:', error);
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    );
  }
}
