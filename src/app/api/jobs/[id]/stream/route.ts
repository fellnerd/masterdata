/**
 * Job Stream API Route (SSE)
 * 
 * GET /api/jobs/[id]/stream - Live-Stream von Job-Logs und Progress
 */

import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getMdsQueue } from '@/lib/queue/queue';
import { QueueEvents } from 'bullmq';
import { getRedisConfig } from '@/lib/queue/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Singleton QueueEvents instance
let queueEventsInstance: QueueEvents | null = null;

function getQueueEvents(queueName: string): QueueEvents {
  if (!queueEventsInstance) {
    queueEventsInstance = new QueueEvents(queueName, {
      connection: getRedisConfig(),
    });
  }
  return queueEventsInstance;
}

/**
 * GET /api/jobs/[id]/stream
 * Server-Sent Events Stream für Job-Updates
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id: jobId } = await params;
  const queue = getMdsQueue();
  const queueEvents = getQueueEvents(queue.name);

  // Check if job exists
  const job = await queue.getJob(jobId);
  if (!job) {
    return new Response('Job not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // Helper to send SSE events
      // Note: We use only 'data:' format (no 'event:' line) for compatibility with onmessage handler
      const send = (type: string, payload: unknown) => {
        const message = `data: ${JSON.stringify({ type, ...payload as Record<string, unknown> })}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Send initial state
      (async () => {
        const state = await job.getState();
        const progress = job.progress as { percent?: number; message?: string; logs?: string[] } | number;
        
        send('init', {
          jobId,
          state,
          progress: typeof progress === 'number' ? progress : (progress?.percent ?? 0),
          logs: typeof progress === 'object' ? (progress?.logs ?? []) : [],
        });
      })();

      // Listen for progress updates
      const onProgress = ({ jobId: eventJobId, data }: { jobId: string; data: unknown }) => {
        if (eventJobId === jobId) {
          const progressData = data as { 
            percent?: number; 
            message?: string; 
            logs?: string[];
            log?: string;
            timestamp?: string;
          };
          
          // Handle single log line (for real-time streaming)
          if (progressData?.log) {
            send('log', {
              message: progressData.log,
              timestamp: progressData.timestamp || new Date().toISOString(),
            });
          }
          
          // Handle progress update with percent/message
          if (typeof progressData?.percent === 'number') {
            send('progress', {
              percent: progressData.percent,
              message: progressData.message ?? '',
              logs: progressData.logs ?? [],
            });
          }
        }
      };

      // Listen for job completion
      const onCompleted = ({ jobId: eventJobId }: { jobId: string }) => {
        if (eventJobId === jobId) {
          send('completed', { jobId });
          cleanup();
        }
      };

      // Listen for job failure
      const onFailed = ({ jobId: eventJobId, failedReason }: { jobId: string; failedReason: string }) => {
        if (eventJobId === jobId) {
          send('failed', { jobId, error: failedReason });
          cleanup();
        }
      };

      // Subscribe to queue events
      queueEvents.on('progress', onProgress);
      queueEvents.on('completed', onCompleted);
      queueEvents.on('failed', onFailed);

      // Cleanup function
      const cleanup = () => {
        queueEvents.off('progress', onProgress);
        queueEvents.off('completed', onCompleted);
        queueEvents.off('failed', onFailed);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Handle client disconnect
      request.signal.addEventListener('abort', cleanup);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          send('heartbeat', { time: Date.now() });
        } catch {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 30000);

      // Cleanup interval on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
