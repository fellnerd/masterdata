/**
 * Job Scheduling Functions
 * 
 * Uses BullMQ's built-in repeatable jobs feature for cron-based scheduling.
 */

import { Queue } from 'bullmq';
import { getRedisConfig, QUEUE_NAMES, MdsJobData, JobType, JOB_TYPE_OPTIONS } from './config';

// Singleton Queue Instance for scheduled jobs
let scheduledQueue: Queue<MdsJobData> | null = null;

/**
 * Get or create the Scheduled Jobs Queue
 */
export function getScheduledQueue(): Queue<MdsJobData> {
  if (!scheduledQueue) {
    if (process.env.QUEUE_MOCK === 'true') {
      console.log('📦 Scheduled queue mock mode - not connecting to Redis');
      return createMockScheduledQueue();
    }
    
    const redisConfig = getRedisConfig();
    console.log('🔌 Connecting to Redis for scheduled jobs');
    
    scheduledQueue = new Queue<MdsJobData>(QUEUE_NAMES.MDS_SCHEDULED, {
      connection: redisConfig,
    });

    console.log('📅 Scheduled Jobs Queue initialized');
  }

  return scheduledQueue;
}

export interface ScheduleOptions {
  name: string;
  cron: string; // Cron expression, e.g., "0 0 * * *" for daily at midnight
  timezone?: string; // e.g., "Europe/Berlin"
  description?: string;
}

export interface ScheduledJobInfo {
  key: string;
  name: string;
  id: string | null | undefined;
  endDate: number | null;
  tz: string | null | undefined;
  pattern: string | null;
  next: number | undefined;
}

/**
 * Add a scheduled (repeatable) job
 */
export async function addScheduledJob(
  type: JobType,
  target: string,
  userId: string,
  userName: string,
  schedule: ScheduleOptions,
  params?: Record<string, unknown>
): Promise<{ key: string; name: string }> {
  console.log('📅 Adding scheduled job:', { type, target, schedule });
  
  const queue = getScheduledQueue();
  
  const jobData: MdsJobData = {
    type,
    target,
    userId,
    userName,
    params,
    createdAt: new Date().toISOString(),
  };

  const jobOptions = JOB_TYPE_OPTIONS[type];
  
  // Use the schedule name as a unique job name to allow removal
  const jobName = schedule.name;
  
  await queue.add(jobName, jobData, {
    priority: jobOptions.priority,
    repeat: {
      pattern: schedule.cron,
      tz: schedule.timezone || 'Europe/Berlin',
    },
  });
  
  // Get the repeat job key for later reference
  const repeatableJobs = await queue.getRepeatableJobs();
  const repeatJobKey = repeatableJobs.find((j: { name: string; key: string }) => j.name === jobName)?.key || jobName;
  
  console.log(`📅 Scheduled job added: ${jobName} (${schedule.cron})`);

  return {
    key: repeatJobKey,
    name: jobName,
  };
}

/**
 * Get all scheduled (repeatable) jobs
 */
export async function getScheduledJobs(): Promise<ScheduledJobInfo[]> {
  const queue = getScheduledQueue();
  
  const repeatableJobs = await queue.getRepeatableJobs();
  
  return repeatableJobs.map((job) => ({
    key: job.key,
    name: job.name,
    id: job.id,
    endDate: job.endDate,
    tz: job.tz,
    pattern: job.pattern,
    next: job.next,
  }));
}

/**
 * Remove a scheduled job by its key
 */
export async function removeScheduledJob(key: string): Promise<boolean> {
  const queue = getScheduledQueue();
  
  const repeatableJobs = await queue.getRepeatableJobs();
  const jobToRemove = repeatableJobs.find((j: { key: string }) => j.key === key);
  
  if (!jobToRemove) {
    console.warn(`📅 Scheduled job not found: ${key}`);
    return false;
  }
  
  await queue.removeRepeatableByKey(key);
  console.log(`📅 Scheduled job removed: ${key}`);
  
  return true;
}

/**
 * Remove a scheduled job by its name
 */
export async function removeScheduledJobByName(name: string, pattern: string): Promise<boolean> {
  const queue = getScheduledQueue();
  
  const removed = await queue.removeRepeatable(name, { pattern });
  
  if (removed) {
    console.log(`📅 Scheduled job removed: ${name} (${pattern})`);
  }
  
  return removed;
}

/**
 * Update a scheduled job (remove old, add new)
 */
export async function updateScheduledJob(
  oldKey: string,
  type: JobType,
  target: string,
  userId: string,
  userName: string,
  schedule: ScheduleOptions,
  params?: Record<string, unknown>
): Promise<{ key: string; name: string }> {
  // First remove the old scheduled job
  await removeScheduledJob(oldKey);
  
  // Then add the new one
  return addScheduledJob(type, target, userId, userName, schedule, params);
}

/**
 * Create a mock scheduled queue for development
 */
function createMockScheduledQueue(): Queue<MdsJobData> {
  return {
    add: async (name: string) => {
      return { id: `mock-scheduled-${Date.now()}`, name };
    },
    getRepeatableJobs: async () => [],
    removeRepeatableByKey: async () => true,
    removeRepeatable: async () => true,
  } as unknown as Queue<MdsJobData>;
}
