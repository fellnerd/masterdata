/**
 * BullMQ Queue Configuration
 * 
 * Job Queue für asynchrone Operationen:
 * - dbt-run: dbt Models ausführen
 * - dbt-test: dbt Tests ausführen  
 * - validate: Datenvalidierung
 * - deploy: Deployment zu Target-DB
 * - schema-deploy: Schema-Änderungen deployen (generate_models.py + dbt run)
 * - import: CSV/Excel Import
 * - export: CSV/Excel Export
 */

import { ConnectionOptions } from 'bullmq';

/**
 * Parse Upstash Redis URL (rediss:// for TLS)
 * Format: rediss://default:password@host:port
 */
function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
  };
}

/**
 * Get Redis configuration - lazy evaluation for env vars
 * Supports Upstash Redis URL (rediss://) or legacy REDIS_HOST/PORT
 */
export function getRedisConfig(): ConnectionOptions {
  const upstashUrl = process.env.UPSTASH_REDIS_URL;
  
  if (upstashUrl) {
    return parseRedisUrl(upstashUrl);
  }
  
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
  };
}

// Keep REDIS_CONFIG for backward compatibility (uses getter)
export const REDIS_CONFIG: ConnectionOptions = new Proxy({} as ConnectionOptions, {
  get(_, prop) {
    return getRedisConfig()[prop as keyof ConnectionOptions];
  },
});

// Queue Names
export const QUEUE_NAMES = {
  MDS_JOBS: 'mds-jobs',
  MDS_SCHEDULED: 'mds-scheduled',
} as const;

// Job Types
export type JobType = 
  | 'dbt-run'
  | 'dbt-test'
  | 'validate'
  | 'deploy'
  | 'schema-deploy'
  | 'bulk-commit'
  | 'import'
  | 'export';

// Job Data Interface
export interface MdsJobData {
  type: JobType;
  target: string;
  userId: string;
  userName: string;
  modelId?: number;
  entityId?: number;
  entityIds?: number[];        // For schema-deploy: list of entity IDs
  entityCodes?: string[];      // For schema/data-deploy: list of entity codes (for dbt selectors)
  deploymentId?: string;       // For schema/data-deploy: tracking ID
  commitIds?: number[];        // For data-deploy: list of commit IDs
  commitId?: number;           // For bulk-commit: the commit ID to populate
  description?: string;        // For bulk-commit: commit description
  params?: Record<string, unknown>;
  createdAt: string;
}

// Job Progress Interface
export interface JobProgress {
  percent: number;
  message: string;
  logs: string[];
}

// Default Job Options
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 60 * 60, // 24 hours
    count: 100,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60, // 7 days
    count: 500,
  },
};

// Job Type Specific Options
export const JOB_TYPE_OPTIONS: Record<JobType, { timeout: number; priority: number }> = {
  'dbt-run': { timeout: 30 * 60 * 1000, priority: 2 },       // 30 min
  'dbt-test': { timeout: 15 * 60 * 1000, priority: 3 },      // 15 min
  'validate': { timeout: 10 * 60 * 1000, priority: 1 },      // 10 min, highest priority
  'deploy': { timeout: 60 * 60 * 1000, priority: 4 },        // 1 hour
  'schema-deploy': { timeout: 30 * 60 * 1000, priority: 2 }, // 30 min for generate_models + dbt
  'bulk-commit': { timeout: 30 * 60 * 1000, priority: 1 },   // 30 min, high priority
  'import': { timeout: 30 * 60 * 1000, priority: 2 },        // 30 min
  'export': { timeout: 15 * 60 * 1000, priority: 3 },        // 15 min
};
