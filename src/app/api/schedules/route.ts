import { NextRequest, NextResponse } from 'next/server'
import { 
  addScheduledJob, 
  getScheduledJobs, 
  removeScheduledJob,
  ScheduleOptions 
} from '@/lib/queue/schedule'
import { JobType } from '@/lib/queue/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/schedules - List all scheduled jobs
 */
export async function GET() {
  try {
    const schedules = await getScheduledJobs()
    
    return NextResponse.json({
      schedules,
      count: schedules.length,
    })
  } catch (error) {
    console.error('Failed to get scheduled jobs:', error)
    return NextResponse.json(
      { error: 'Failed to get scheduled jobs' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/schedules - Create a new scheduled job
 * 
 * Body:
 * - type: JobType (dbt-run, dbt-test, validate, deploy, schema-deploy, import, export)
 * - target: string (e.g., "hub_customer, sat_customer" for dbt-run)
 * - schedule: { name, cron, timezone?, description? }
 * - params?: Record<string, unknown>
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, target, schedule, params } = body as {
      type: JobType
      target: string
      schedule: ScheduleOptions
      params?: Record<string, unknown>
    }
    
    // Validate required fields
    if (!type || !target || !schedule?.name || !schedule?.cron) {
      return NextResponse.json(
        { error: 'Missing required fields: type, target, schedule.name, schedule.cron' },
        { status: 400 }
      )
    }
    
    // Validate cron expression (basic check)
    const cronParts = schedule.cron.trim().split(/\s+/)
    if (cronParts.length < 5 || cronParts.length > 6) {
      return NextResponse.json(
        { error: 'Invalid cron expression. Expected 5 or 6 parts (minute hour day month weekday [year])' },
        { status: 400 }
      )
    }
    
    // TODO: Get actual user from session
    const userId = 'admin'
    const userName = 'System Admin'
    
    const result = await addScheduledJob(
      type,
      target,
      userId,
      userName,
      schedule,
      params
    )
    
    return NextResponse.json({
      success: true,
      key: result.key,
      name: result.name,
      message: `Zeitplan "${schedule.name}" erstellt`,
    })
  } catch (error) {
    console.error('Failed to create scheduled job:', error)
    return NextResponse.json(
      { error: 'Failed to create scheduled job', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/schedules?key=<key> - Remove a scheduled job
 */
export async function DELETE(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key')
    
    if (!key) {
      return NextResponse.json(
        { error: 'Missing required parameter: key' },
        { status: 400 }
      )
    }
    
    const success = await removeScheduledJob(key)
    
    if (!success) {
      return NextResponse.json(
        { error: 'Scheduled job not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      success: true,
      message: 'Zeitplan gelöscht',
    })
  } catch (error) {
    console.error('Failed to delete scheduled job:', error)
    return NextResponse.json(
      { error: 'Failed to delete scheduled job' },
      { status: 500 }
    )
  }
}
