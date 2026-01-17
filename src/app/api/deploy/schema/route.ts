import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { getMdsQueue } from '@/lib/queue/queue'
import { JOB_TYPE_OPTIONS, MdsJobData } from '@/lib/queue/config'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SchemaDeployment {
  id: number
  entity_id: number
  entity_code: string
  entity_name: string
  model_code: string
  model_name: string
  attribute_count: number
  scd_type: string
  status: 'pending' | 'queued' | 'failed' | 'deployed'
  created_at: string
  updated_at: string | null
  deployed_at: string | null
  deployed_by: string | null
}

// GET /api/deploy/schema - Get pending schema deployments
// Supports multiple statuses via comma-separated list: ?status=pending,queued,failed
export async function GET(request: NextRequest) {
  logger.info('GET /api/deploy/schema')
  
  try {
    const { searchParams } = new URL(request.url)
    const statusParam = searchParams.get('status') || 'pending'
    const statuses = statusParam.split(',').map(s => s.trim()).filter(s => s)
    
    // Build dynamic IN clause for multiple statuses
    const statusPlaceholders = statuses.map((_, i) => `@status${i}`).join(', ')
    const statusParams: Record<string, string> = {}
    statuses.forEach((s, i) => { statusParams[`status${i}`] = s })
    
    const results = await dbQuery<SchemaDeployment>(
      `SELECT 
        sd.id,
        sd.entity_id,
        e.code AS entity_code,
        e.name AS entity_name,
        m.code AS model_code,
        m.name AS model_name,
        (SELECT COUNT(*) FROM mds_meta.attribute a WHERE a.entity_id = e.id) AS attribute_count,
        e.scd_type,
        sd.status,
        sd.created_at,
        sd.updated_at,
        sd.deployed_at,
        sd.deployed_by
       FROM mds_meta.schema_deployment sd
       JOIN mds_meta.entity e ON e.id = sd.entity_id
       JOIN mds_meta.model m ON m.id = e.model_id
       WHERE sd.status IN (${statusPlaceholders})
       ORDER BY sd.created_at DESC`,
      statusParams
    )
    
    return NextResponse.json({
      data: results,
      total: results.length
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch schema deployments')
    return NextResponse.json(
      { error: 'Failed to fetch schema deployments', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/deploy/schema - Deploy selected schema changes via Job Queue
export async function POST(request: NextRequest) {
  logger.info('POST /api/deploy/schema')
  
  try {
    const body = await request.json()
    const { entity_ids, deployed_by = 'admin' } = body
    
    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return NextResponse.json(
        { error: 'entity_ids array is required' },
        { status: 400 }
      )
    }

    // Fetch entity codes for dbt model selection
    const entities = await dbQuery<{ id: number; code: string }>(
      `SELECT id, code FROM mds_meta.entity WHERE id IN (${entity_ids.join(',')})`,
      {}
    )
    const entityCodes = entities.map(e => e.code.toLowerCase())
    
    logger.info({ entity_ids, entityCodes }, 'Fetched entity codes for deployment')

    // Generate unique deployment ID
    const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    logger.info({ deploymentId, entity_ids }, 'Creating schema deployment job')

    // Update schema_deployment status to 'queued'
    for (const entityId of entity_ids) {
      await dbExecute(
        `UPDATE mds_meta.schema_deployment 
         SET status = 'queued', 
             updated_at = GETUTCDATE()
         WHERE entity_id = @entityId AND status = 'pending'`,
        { entityId }
      )
    }

    // Check if queue is in mock mode
    if (process.env.QUEUE_MOCK === 'true') {
      // Mock mode: Directly update status (for development without Redis)
      logger.info('Queue mock mode - executing schema deploy directly')
      
      for (const entityId of entity_ids) {
        // Update schema_deployment to deployed
        await dbExecute(
          `UPDATE mds_meta.schema_deployment 
           SET status = 'deployed', 
               deployed_at = GETUTCDATE(), 
               deployed_by = @deployedBy
           WHERE entity_id = @entityId`,
          { entityId, deployedBy: deployed_by }
        )
        
        // Set entity status to active
        await dbExecute(
          `UPDATE mds_meta.entity 
           SET status = 'active', 
               updated_at = GETUTCDATE(), 
               updated_by = @deployedBy
           WHERE id = @entityId AND status IN ('draft', 'pending')`,
          { entityId, deployedBy: deployed_by }
        )
      }
      
      return NextResponse.json({
        success: true,
        mode: 'mock',
        deployed_count: entity_ids.length,
        deployed_entities: entity_ids,
        deployed_at: new Date().toISOString(),
        deployed_by
      })
    }

    // Real mode: Add job to queue
    const queue = getMdsQueue()
    
    const jobData: MdsJobData = {
      type: 'schema-deploy',
      target: `entities:${entity_ids.join(',')}`,
      userId: deployed_by,
      userName: deployed_by,
      entityIds: entity_ids,
      entityCodes,  // Pass entity codes for dbt model selection
      deploymentId,
      createdAt: new Date().toISOString()
    }

    const jobOptions = JOB_TYPE_OPTIONS['schema-deploy']
    
    const job = await queue.add('schema-deploy', jobData, {
      jobId: deploymentId,
      priority: jobOptions.priority,
    })

    logger.info({ jobId: job.id, deploymentId }, 'Schema deploy job created')
    
    return NextResponse.json({
      success: true,
      mode: 'queue',
      jobId: job.id,
      deploymentId,
      entity_ids,
      message: 'Schema deployment job queued',
      stream_url: `/api/jobs/${job.id}/stream`
    })

  } catch (error) {
    logger.error({ error }, 'Failed to create schema deployment job')
    return NextResponse.json(
      { error: 'Failed to create schema deployment job', details: String(error) },
      { status: 500 }
    )
  }
}

// PUT /api/deploy/schema - Update deployment status (called by worker on completion)
export async function PUT(request: NextRequest) {
  logger.info('PUT /api/deploy/schema')
  
  try {
    const body = await request.json()
    const { entity_ids, status, deployed_by = 'system', error_message } = body
    
    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return NextResponse.json(
        { error: 'entity_ids array is required' },
        { status: 400 }
      )
    }

    if (!['deployed', 'failed'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be "deployed" or "failed"' },
        { status: 400 }
      )
    }

    for (const entityId of entity_ids) {
      if (status === 'deployed') {
        // Success: Update schema_deployment and entity status
        await dbExecute(
          `UPDATE mds_meta.schema_deployment 
           SET status = 'deployed', 
               deployed_at = GETUTCDATE(), 
               deployed_by = @deployedBy
           WHERE entity_id = @entityId`,
          { entityId, deployedBy: deployed_by }
        )
        
        // Set entity status to active ONLY on success
        await dbExecute(
          `UPDATE mds_meta.entity 
           SET status = 'active', 
               updated_at = GETUTCDATE(), 
               updated_by = @deployedBy
           WHERE id = @entityId AND status IN ('draft', 'pending')`,
          { entityId, deployedBy: deployed_by }
        )
        
        logger.info({ entityId }, 'Entity deployed and activated')
      } else {
        // Failure: Update schema_deployment but NOT entity status
        await dbExecute(
          `UPDATE mds_meta.schema_deployment 
           SET status = 'failed', 
               updated_at = GETUTCDATE()
           WHERE entity_id = @entityId`,
          { entityId }
        )
        
        logger.warn({ entityId, error_message }, 'Entity deployment failed')
      }
    }

    return NextResponse.json({
      success: true,
      status,
      updated_count: entity_ids.length
    })

  } catch (error) {
    logger.error({ error }, 'Failed to update deployment status')
    return NextResponse.json(
      { error: 'Failed to update deployment status', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/deploy/schema - Reset queued/failed schema deployments back to pending
export async function DELETE(request: NextRequest) {
  logger.info('DELETE /api/deploy/schema - Reset status')
  
  try {
    const body = await request.json()
    const { entity_ids } = body
    
    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return NextResponse.json(
        { error: 'entity_ids array is required' },
        { status: 400 }
      )
    }
    
    // Reset status to pending for queued/failed entities
    const placeholders = entity_ids.map((_: number, i: number) => `@id${i}`).join(', ')
    const params: Record<string, number> = {}
    entity_ids.forEach((id: number, i: number) => { params[`id${i}`] = id })
    
    const result = await dbExecute(
      `UPDATE mds_meta.schema_deployment 
       SET status = 'pending', updated_at = GETUTCDATE()
       WHERE entity_id IN (${placeholders}) AND status IN ('queued', 'failed')`,
      params
    )
    
    const rowsAffected = typeof result === 'object' && result !== null && 'rowsAffected' in result 
      ? (result as { rowsAffected?: number }).rowsAffected 
      : undefined
    
    logger.info({ entity_ids, rowsAffected }, 'Reset schema deployment status to pending')
    
    return NextResponse.json({
      success: true,
      reset_count: rowsAffected || entity_ids.length
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to reset schema deployment status')
    return NextResponse.json(
      { error: 'Failed to reset status', details: String(error) },
      { status: 500 }
    )
  }
}
