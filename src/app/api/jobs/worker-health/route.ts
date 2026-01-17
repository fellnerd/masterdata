/**
 * Worker Health API Route
 * 
 * GET /api/jobs/worker-health - Prüft den Status des Workers
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMdsQueue } from '@/lib/queue/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface WorkerHealthResponse {
  status: 'healthy' | 'idle' | 'unhealthy' | 'error';
  workers: number;
  isPaused: boolean;
  lastActivity: string | null;
  queuedJobs: number;
  activeJobs: number;
  error?: string;
}

/**
 * GET /api/jobs/worker-health
 * Prüft ob der Worker aktiv ist und läuft
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const queue = getMdsQueue();
    
    try {
      // Worker-Info aus Redis holen
      const workers = await queue.getWorkers();
      const isPaused = await queue.isPaused();
      const counts = await queue.getJobCounts();
      
      // Letzte Aktivität prüfen
      const recentCompleted = await queue.getCompleted(0, 1);
      const lastActivity = recentCompleted[0]?.finishedOn 
        ? new Date(recentCompleted[0].finishedOn)
        : null;
      
      // Status bestimmen
      const hasWorkers = workers.length > 0;
      const isStale = lastActivity && (Date.now() - lastActivity.getTime()) > 5 * 60 * 1000;
      
      let status: WorkerHealthResponse['status'];
      if (!hasWorkers) {
        status = 'unhealthy';
      } else if (isPaused) {
        status = 'unhealthy';
      } else if (counts.active > 0) {
        status = 'healthy';
      } else if (isStale && counts.waiting === 0) {
        status = 'idle';
      } else {
        status = 'healthy';
      }
      
      const response: WorkerHealthResponse = {
        status,
        workers: workers.length,
        isPaused,
        lastActivity: lastActivity?.toISOString() || null,
        queuedJobs: counts.waiting + counts.delayed,
        activeJobs: counts.active
      };
      
      return NextResponse.json(response);
    } catch (queueError) {
      // Queue-Fehler (z.B. Redis nicht erreichbar)
      console.error('Queue error in worker-health:', queueError);
      
      const response: WorkerHealthResponse = {
        status: 'error',
        workers: 0,
        isPaused: false,
        lastActivity: null,
        queuedJobs: 0,
        activeJobs: 0,
        error: queueError instanceof Error ? queueError.message : 'Queue error'
      };
      
      return NextResponse.json(response);
    }
  } catch (error) {
    console.error('Failed to check worker health:', error);
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to check worker health',
      workers: 0,
      isPaused: false,
      lastActivity: null,
      queuedJobs: 0,
      activeJobs: 0
    }, { status: 500 });
  }
}
