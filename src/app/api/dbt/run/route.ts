import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '@/lib/logger'

/**
 * dbt Run API
 * 
 * HINWEIS: Diese API ist ein PLACEHOLDER für zukünftige BullMQ Integration.
 * dbt wird aktuell NICHT automatisch ausgeführt.
 * 
 * Manueller Workflow:
 * 1. Deploy API lädt Daten in mds_load
 * 2. MANUELL: ./scripts/deploy.sh --entity <code>
 * 3. View Deploy API erstellt Views auf mds_master
 * 
 * Später: BullMQ Worker führt dbt via scripts/deploy.sh aus
 */

// Types
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'manual_required'

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
  manual_command?: string // Manueller Befehl für User
}

// In-memory job store (would use Redis/BullMQ in production)
const jobs: Map<string, DbtJob> = new Map()

// POST /api/dbt/run - Request a dbt run (currently manual)
export async function POST(request: NextRequest) {
  logger.info('POST /api/dbt/run')
  
  try {
    const body = await request.json()
    const { 
      commit_id,
      command = 'dbt run',
      models,       // Optional: specific models to run
      full_refresh  // Optional: force full refresh
    } = body
    
    // Build the full command
    let fullCommand = command
    if (models && models.length > 0) {
      fullCommand += ` --select ${models.join(' ')}`
    }
    if (full_refresh) {
      fullCommand += ' --full-refresh'
    }
    
    // Build manual command for user
    let manualCommand = 'cd ~/projects/datavault-dbt/masterdata/dbt && ./scripts/deploy.sh'
    if (models && models.length > 0) {
      // Extract entity code from model name (e.g., mds_customer -> customer)
      const entityCode = models[0].replace('mds_', '').replace('mds_master.', '')
      manualCommand += ` --entity ${entityCode}`
    }
    if (full_refresh) {
      manualCommand += ' --full-refresh'
    }
    
    const job: DbtJob = {
      job_id: uuidv4(),
      commit_id: commit_id || null,
      command: fullCommand,
      status: 'manual_required',  // Changed from 'queued'
      started_at: null,
      completed_at: null,
      created_by: 'admin',
      logs: [
        `[${new Date().toISOString()}] dbt job registered`,
        `[${new Date().toISOString()}] MANUAL EXECUTION REQUIRED`,
        `[${new Date().toISOString()}] Run: ${manualCommand}`,
      ],
      exit_code: null,
      models_run: 0,
      models_success: 0,
      models_error: 0,
      manual_command: manualCommand,
    }
    
    jobs.set(job.job_id, job)
    
    logger.info({ jobId: job.job_id, manualCommand }, 'dbt job registered (manual execution required)')
    
    // TODO: BullMQ Integration
    // await dbtQueue.add('dbt-run', { job_id: job.job_id, command: fullCommand })
    
    return NextResponse.json({
      job_id: job.job_id,
      status: job.status,
      message: 'dbt job registered. Manual execution required.',
      manual_command: manualCommand,
      note: 'BullMQ worker integration pending. Run the command manually on the server.',
    })
  } catch (error) {
    logger.error({ error }, 'Failed to start dbt run')
    return NextResponse.json(
      { error: 'Failed to start dbt run' },
      { status: 500 }
    )
  }
}

// GET /api/dbt/run - List all jobs
export async function GET(request: NextRequest) {
  logger.info('GET /api/dbt/run')
  
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as JobStatus | null
    const limit = parseInt(searchParams.get('limit') || '20')
    
    let results = Array.from(jobs.values())
    
    if (status) {
      results = results.filter(j => j.status === status)
    }
    
    // Sort by most recent
    results = results.sort((a, b) => {
      const aTime = a.started_at || '0'
      const bTime = b.started_at || '0'
      return bTime.localeCompare(aTime)
    }).slice(0, limit)
    
    // Add some mock historical jobs if empty
    if (results.length === 0) {
      results = [
        {
          job_id: 'job-hist-001',
          commit_id: 'commit-001',
          command: 'dbt run --select stg_* hub_* sat_*',
          status: 'completed' as JobStatus,
          started_at: '2023-03-20T10:00:00Z',
          completed_at: '2023-03-20T10:05:32Z',
          created_by: 'admin',
          logs: [],
          exit_code: 0,
          models_run: 12,
          models_success: 12,
          models_error: 0,
        },
        {
          job_id: 'job-hist-002',
          commit_id: 'commit-002',
          command: 'dbt test',
          status: 'completed' as JobStatus,
          started_at: '2023-03-20T10:06:00Z',
          completed_at: '2023-03-20T10:08:45Z',
          created_by: 'admin',
          logs: [],
          exit_code: 0,
          models_run: 8,
          models_success: 8,
          models_error: 0,
        },
        {
          job_id: 'job-hist-003',
          commit_id: null,
          command: 'dbt run --select hub_supplier',
          status: 'failed' as JobStatus,
          started_at: '2023-03-19T15:00:00Z',
          completed_at: '2023-03-19T15:02:11Z',
          created_by: 'editor1',
          logs: ['Error: Compilation error in model hub_supplier'],
          exit_code: 1,
          models_run: 1,
          models_success: 0,
          models_error: 1,
        },
      ]
    }
    
    return NextResponse.json({
      data: results,
      total: results.length,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to list dbt jobs')
    return NextResponse.json(
      { error: 'Failed to list dbt jobs' },
      { status: 500 }
    )
  }
}
