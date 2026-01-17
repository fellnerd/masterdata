import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// Types
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

interface DbtJob {
  job_id: string
  commit_id: string | null
  command: string
  status: JobStatus
  started_at: string | null
  completed_at: string | null
  created_by: string
  logs: string[]
  exit_code: number | null
  models_run: number
  models_success: number
  models_error: number
}

// Mock job data
const mockJob: DbtJob = {
  job_id: 'job-001',
  commit_id: 'commit-003',
  command: 'dbt run --select stg_* hub_* sat_*',
  status: 'running',
  started_at: '2023-03-20T10:00:00Z',
  completed_at: null,
  created_by: 'admin',
  logs: [
    '[2023-03-20T10:00:00Z] Starting dbt run...',
    '[2023-03-20T10:00:01Z] Running: dbt run --select stg_* hub_* sat_*',
    '[2023-03-20T10:00:02Z] Found 12 models to run',
    '[2023-03-20T10:00:05Z] 1 of 12 START model stg.stg_company_client',
    '[2023-03-20T10:00:08Z] 1 of 12 OK created view stg.stg_company_client [OK in 3s]',
    '[2023-03-20T10:00:09Z] 2 of 12 START model vault.hub_company_client',
    '[2023-03-20T10:00:15Z] 2 of 12 OK created table vault.hub_company_client [OK in 6s]',
    '[2023-03-20T10:00:16Z] 3 of 12 START model vault.sat_company_client',
  ],
  exit_code: null,
  models_run: 3,
  models_success: 3,
  models_error: 0,
}

// GET /api/dbt/run/[jobId] - Get job status and logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  logger.info({ jobId }, 'GET /api/dbt/run/[jobId]')
  
  try {
    // TODO: Get from jobs store or database
    const job = { ...mockJob, job_id: jobId }
    
    return NextResponse.json(job)
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to fetch job')
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    )
  }
}

// DELETE /api/dbt/run/[jobId] - Cancel a running or queued job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  logger.info({ jobId }, 'DELETE /api/dbt/run/[jobId]')
  
  try {
    // TODO: Cancel the job in BullMQ
    // const job = await dbtQueue.getJob(jobId)
    // if (job) {
    //   await job.remove()
    // }
    
    // TODO: If running, kill the process
    
    return NextResponse.json({
      job_id: jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully',
    })
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to cancel job')
    return NextResponse.json(
      { error: 'Failed to cancel job' },
      { status: 500 }
    )
  }
}

// POST /api/dbt/run/[jobId] - Retry a failed job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  logger.info({ jobId }, 'POST /api/dbt/run/[jobId] (retry)')
  
  try {
    // TODO: Get original job and create a new one with same parameters
    const newJobId = `${jobId}-retry-${Date.now()}`
    
    return NextResponse.json({
      original_job_id: jobId,
      new_job_id: newJobId,
      status: 'queued',
      message: 'Job retry queued successfully',
    }, { status: 201 })
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to retry job')
    return NextResponse.json(
      { error: 'Failed to retry job' },
      { status: 500 }
    )
  }
}
