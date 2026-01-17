/**
 * Bulk Jobs API Route
 * 
 * POST /api/jobs/bulk - Bulk-Aktionen auf mehrere Jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMdsQueue } from '@/lib/queue/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BulkRequest {
  action: 'retry' | 'cancel' | 'remove';
  jobIds: string[];
}

interface BulkResult {
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * POST /api/jobs/bulk
 * Führt eine Aktion auf mehreren Jobs aus
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as BulkRequest;
    const { action, jobIds } = body;

    if (!action || !['retry', 'cancel', 'remove'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be one of: retry, cancel, remove' },
        { status: 400 }
      );
    }

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json(
        { error: 'jobIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (jobIds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 jobs per bulk operation' },
        { status: 400 }
      );
    }

    const queue = getMdsQueue();
    const result: BulkResult = {
      success: [],
      failed: []
    };

    // Process each job
    for (const jobId of jobIds) {
      try {
        const job = await queue.getJob(jobId);
        
        if (!job) {
          result.failed.push({ id: jobId, error: 'Job not found' });
          continue;
        }

        const state = await job.getState();

        switch (action) {
          case 'retry':
            if (state === 'failed') {
              await job.retry();
              result.success.push(jobId);
            } else {
              result.failed.push({ id: jobId, error: `Cannot retry job in state: ${state}` });
            }
            break;

          case 'cancel':
            if (state === 'active' || state === 'waiting' || state === 'delayed') {
              await job.moveToFailed(new Error('Cancelled by user'), 'user-cancelled');
              result.success.push(jobId);
            } else {
              result.failed.push({ id: jobId, error: `Cannot cancel job in state: ${state}` });
            }
            break;

          case 'remove':
            await job.remove();
            result.success.push(jobId);
            break;
        }
      } catch (jobError) {
        result.failed.push({ 
          id: jobId, 
          error: jobError instanceof Error ? jobError.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      action,
      total: jobIds.length,
      successCount: result.success.length,
      failedCount: result.failed.length,
      ...result
    });
  } catch (error) {
    console.error('Bulk operation failed:', error);
    return NextResponse.json(
      { error: 'Bulk operation failed' },
      { status: 500 }
    );
  }
}
