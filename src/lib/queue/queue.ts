/**
 * BullMQ Queue Instance
 * 
 * Singleton Queue für MDS Jobs
 */

import { Queue } from 'bullmq';
import { 
  getRedisConfig, 
  QUEUE_NAMES, 
  DEFAULT_JOB_OPTIONS, 
  JOB_TYPE_OPTIONS,
  MdsJobData,
  JobType 
} from './config';

// Singleton Queue Instance
let mdsQueue: Queue<MdsJobData> | null = null;

/**
 * Get or create the MDS Job Queue
 */
export function getMdsQueue(): Queue<MdsJobData> {
  if (!mdsQueue) {
    // Check if we're in mock mode
    if (process.env.QUEUE_MOCK === 'true') {
      console.log('📦 Queue mock mode - not connecting to Redis');
      // Return a mock queue that doesn't actually connect
      return createMockQueue();
    }
    
    const redisConfig = getRedisConfig();
    console.log('🔌 Connecting to Redis:', { 
      host: (redisConfig as { host?: string }).host, 
      port: (redisConfig as { port?: number }).port, 
      tls: !!(redisConfig as { tls?: unknown }).tls 
    });
    
    mdsQueue = new Queue<MdsJobData>(QUEUE_NAMES.MDS_JOBS, {
      connection: redisConfig,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });

    console.log('📬 MDS Job Queue initialized');
  }

  return mdsQueue;
}

/**
 * Add a job to the queue
 * @param type - Job type (deploy, schema-deploy, etc.)
 * @param target - Job target identifier
 * @param userId - User ID
 * @param userName - User display name
 * @param params - Additional job parameters
 * @param options - Additional options
 * @param options.paused - If true, job is created in 'delayed' state and won't start automatically
 */
export async function addJob(
  type: JobType,
  target: string,
  userId: string,
  userName: string,
  params?: Record<string, unknown>,
  options?: { paused?: boolean }
): Promise<{ id: string; name: string; paused: boolean }> {
  console.log('⏳ addJob called:', { type, target, userId, paused: options?.paused });
  
  const queue = getMdsQueue();
  console.log('✅ Got queue instance');
  
  const jobData: MdsJobData = {
    type,
    target,
    userId,
    userName,
    params,
    createdAt: new Date().toISOString(),
  };

  const jobOptions = JOB_TYPE_OPTIONS[type];
  console.log('⏳ Calling queue.add()...');
  
  // If paused, use a very long delay (1 year) - job can be "unpaused" by promoting it
  const delay = options?.paused ? 365 * 24 * 60 * 60 * 1000 : undefined;
  
  const job = await queue.add(type, jobData, {
    priority: jobOptions.priority,
    delay,
  });
  
  console.log('✅ queue.add() completed, job.id:', job.id, 'delayed:', !!delay);

  console.log(`📬 Job added: ${type} - ${target} (${job.id})${options?.paused ? ' [PAUSED]' : ''}`);

  return {
    id: job.id || '',
    name: job.name,
    paused: !!options?.paused,
  };
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const queue = getMdsQueue();
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

/**
 * Get recent jobs
 */
export async function getRecentJobs(limit: number = 20) {
  const queue = getMdsQueue();
  
  const [active, waiting, completed, failed, delayed] = await Promise.all([
    queue.getActive(0, limit),
    queue.getWaiting(0, limit),
    queue.getCompleted(0, limit),
    queue.getFailed(0, limit),
    queue.getDelayed(0, limit),
  ]);

  // Get actual state for each job
  const jobsWithState = await Promise.all([
    ...active.map(async job => ({ job, state: 'active' as const })),
    ...waiting.map(async job => ({ job, state: 'waiting' as const })),
    ...completed.map(async job => ({ job, state: 'completed' as const })),
    ...failed.map(async job => ({ job, state: 'failed' as const })),
    ...delayed.map(async job => ({ job, state: 'delayed' as const })),
  ]);

  const allJobs = jobsWithState
    .sort((a, b) => (b.job.timestamp || 0) - (a.job.timestamp || 0))
    .slice(0, limit);

  return allJobs.map(({ job, state }) => {
    // Extract logs from multiple possible sources
    const progressLogs = (job.progress as { logs?: string[] })?.logs || [];
    const returnValueLogs = (job.returnvalue as { logs?: string[] })?.logs || [];
    // Use returnvalue logs for completed jobs, progress logs for running jobs
    const logs = state === 'completed' || state === 'failed' 
      ? (returnValueLogs.length > 0 ? returnValueLogs : progressLogs)
      : progressLogs;

    return {
      id: job.id,
      name: job.name,
      type: job.name, // job.name is the job type in BullMQ
      data: job.data,
      status: state,
      progress: typeof job.progress === 'number' ? job.progress : 
                (job.progress as { percent?: number })?.percent || 0,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      logs,
    };
  });
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const queue = getMdsQueue();
  const job = await queue.getJob(jobId);
  
  if (!job) {
    return false;
  }

  // Can only cancel waiting or delayed jobs
  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    return true;
  }

  return false;
}

/**
 * Promote a delayed (paused) job to start immediately
 */
export async function promoteJob(jobId: string): Promise<boolean> {
  const queue = getMdsQueue();
  const job = await queue.getJob(jobId);
  
  if (!job) {
    return false;
  }

  // Can only promote delayed jobs
  const state = await job.getState();
  if (state === 'delayed') {
    await job.promote();
    console.log(`📬 Job promoted: ${jobId}`);
    return true;
  }

  return false;
}

/**
 * Create a mock queue for development without Redis
 */
function createMockQueue(): Queue<MdsJobData> {
  // Create a proxy that returns mock data
  const mockJobs: Array<{
    id: string;
    name: string;
    data: MdsJobData;
    state: string;
    progress: number;
    timestamp: number;
  }> = [
    {
      id: 'mock-1',
      name: 'dbt-run',
      data: {
        type: 'dbt-run',
        target: 'hub_customer, sat_customer',
        userId: 'admin',
        userName: 'Admin',
        createdAt: new Date().toISOString(),
      },
      state: 'active',
      progress: 73,
      timestamp: Date.now() - 60000,
    },
    {
      id: 'mock-2',
      name: 'validate',
      data: {
        type: 'validate',
        target: 'All Entities',
        userId: 'scheduler',
        userName: 'Scheduler',
        createdAt: new Date().toISOString(),
      },
      state: 'waiting',
      progress: 0,
      timestamp: Date.now() - 30000,
    },
  ];

  return {
    add: async (name: string, data: MdsJobData) => {
      const id = `mock-${Date.now()}`;
      mockJobs.push({
        id,
        name,
        data,
        state: 'waiting',
        progress: 0,
        timestamp: Date.now(),
      });
      return { id, name };
    },
    getWaitingCount: async () => mockJobs.filter(j => j.state === 'waiting').length,
    getActiveCount: async () => mockJobs.filter(j => j.state === 'active').length,
    getCompletedCount: async () => 2,
    getFailedCount: async () => 1,
    getDelayedCount: async () => 0,
    getActive: async () => mockJobs.filter(j => j.state === 'active'),
    getWaiting: async () => mockJobs.filter(j => j.state === 'waiting'),
    getCompleted: async () => [],
    getFailed: async () => [],
    getJob: async (id: string) => mockJobs.find(j => j.id === id),
  } as unknown as Queue<MdsJobData>;
}

/**
 * Close the queue connection
 */
export async function closeQueue() {
  if (mdsQueue) {
    await mdsQueue.close();
    mdsQueue = null;
    console.log('📬 MDS Job Queue closed');
  }
}
