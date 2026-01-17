import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Entity Views API
 * 
 * Manages view configurations for Master Data entities.
 * Views can be:
 * - scd1: Only current records (WHERE is_current = 1)
 * - scd2: Full history (all versions)
 * - custom: User-defined SQL query
 */

interface EntityView {
  id: number
  entity_id: number
  entity_code?: string
  entity_name?: string
  code: string
  name: string
  description: string | null
  view_type: 'scd1' | 'scd2' | 'custom'
  custom_sql: string | null
  column_config: string | null
  filter_condition: string | null
  is_default: boolean
  is_deployed: boolean
  last_deployed_at: string | null
  created_at: string
  created_by: string
  updated_at: string | null
  updated_by: string | null
}

// GET /api/views - List all views or views for specific entity
export async function GET(request: NextRequest) {
  logger.info('GET /api/views')
  
  try {
    const { searchParams } = new URL(request.url)
    const entityId = searchParams.get('entity_id')
    
    let query = `
      SELECT 
        v.id,
        v.entity_id,
        e.code as entity_code,
        e.name as entity_name,
        v.code,
        v.name,
        v.description,
        v.view_type,
        v.custom_sql,
        v.column_config,
        v.filter_condition,
        v.is_default,
        v.is_deployed,
        v.last_deployed_at,
        v.created_at,
        v.created_by,
        v.updated_at,
        v.updated_by
      FROM mds_meta.entity_view v
      JOIN mds_meta.entity e ON v.entity_id = e.id
    `
    
    const params: Record<string, unknown> = {}
    
    if (entityId) {
      query += ' WHERE v.entity_id = @entityId'
      params.entityId = parseInt(entityId)
    }
    
    query += ' ORDER BY e.name, v.is_default DESC, v.name'
    
    const views = await dbQuery<EntityView>(query, params)
    
    return NextResponse.json({
      views,
      count: views.length
    })
  } catch (error) {
    logger.error({ error }, 'Failed to fetch views')
    return NextResponse.json(
      { error: 'Failed to fetch views' },
      { status: 500 }
    )
  }
}

// POST /api/views - Create a new view
export async function POST(request: NextRequest) {
  logger.info('POST /api/views')
  
  try {
    const body = await request.json()
    const {
      entity_id,
      code,
      name,
      description,
      view_type = 'scd1',
      custom_sql,
      column_config,
      filter_condition,
      is_default = false,
      user = 'admin'
    } = body
    
    // Validation
    if (!entity_id || !code || !name) {
      return NextResponse.json(
        { error: 'entity_id, code, and name are required' },
        { status: 400 }
      )
    }
    
    if (!['scd1', 'scd2', 'custom'].includes(view_type)) {
      return NextResponse.json(
        { error: 'view_type must be scd1, scd2, or custom' },
        { status: 400 }
      )
    }
    
    if (view_type === 'custom' && !custom_sql) {
      return NextResponse.json(
        { error: 'custom_sql is required for custom view type' },
        { status: 400 }
      )
    }
    
    // Check entity exists
    const entities = await dbQuery<{ id: number }>(
      'SELECT id FROM mds_meta.entity WHERE id = @entityId',
      { entityId: entity_id }
    )
    
    if (entities.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }
    
    // If this is set as default, unset other defaults for this entity
    if (is_default) {
      await dbExecute(
        'UPDATE mds_meta.entity_view SET is_default = 0 WHERE entity_id = @entityId',
        { entityId: entity_id }
      )
    }
    
    // Insert new view
    const result = await dbQuery<{ id: number }>(
      `INSERT INTO mds_meta.entity_view 
       (entity_id, code, name, description, view_type, custom_sql, column_config, filter_condition, is_default, created_by)
       OUTPUT INSERTED.id
       VALUES (@entityId, @code, @name, @description, @viewType, @customSql, @columnConfig, @filterCondition, @isDefault, @user)`,
      {
        entityId: entity_id,
        code,
        name,
        description: description || null,
        viewType: view_type,
        customSql: custom_sql || null,
        columnConfig: column_config ? JSON.stringify(column_config) : null,
        filterCondition: filter_condition || null,
        isDefault: is_default ? 1 : 0,
        user
      }
    )
    
    logger.info({ viewId: result[0].id, code }, 'View created')
    
    return NextResponse.json({
      id: result[0].id,
      message: 'View created successfully'
    }, { status: 201 })
    
  } catch (error) {
    logger.error({ error }, 'Failed to create view')
    
    // Check for unique constraint violation
    const errorStr = String(error)
    if (errorStr.includes('UQ_entity_view_entity_code') || errorStr.includes('Violation of UNIQUE KEY constraint') || errorStr.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'Eine View mit diesem Code existiert bereits für diese Entity. Bitte wählen Sie einen anderen Code.' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create view', details: errorStr },
      { status: 500 }
    )
  }
}

// PATCH /api/views - Update a view
export async function PATCH(request: NextRequest) {
  logger.info('PATCH /api/views')
  
  try {
    const body = await request.json()
    const {
      id,
      name,
      description,
      view_type,
      custom_sql,
      column_config,
      filter_condition,
      is_default,
      user = 'admin'
    } = body
    
    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }
    
    // Get existing view
    const views = await dbQuery<EntityView>(
      'SELECT * FROM mds_meta.entity_view WHERE id = @id',
      { id }
    )
    
    if (views.length === 0) {
      return NextResponse.json(
        { error: 'View not found' },
        { status: 404 }
      )
    }
    
    const view = views[0]
    
    // If setting as default, unset others
    if (is_default && !view.is_default) {
      await dbExecute(
        'UPDATE mds_meta.entity_view SET is_default = 0 WHERE entity_id = @entityId',
        { entityId: view.entity_id }
      )
    }
    
    // Build update query
    const updates: string[] = []
    const params: Record<string, unknown> = { id }
    
    if (name !== undefined) {
      updates.push('name = @name')
      params.name = name
    }
    if (description !== undefined) {
      updates.push('description = @description')
      params.description = description
    }
    if (view_type !== undefined) {
      updates.push('view_type = @viewType')
      params.viewType = view_type
    }
    if (custom_sql !== undefined) {
      updates.push('custom_sql = @customSql')
      params.customSql = custom_sql
    }
    if (column_config !== undefined) {
      updates.push('column_config = @columnConfig')
      params.columnConfig = column_config ? JSON.stringify(column_config) : null
    }
    if (filter_condition !== undefined) {
      updates.push('filter_condition = @filterCondition')
      params.filterCondition = filter_condition
    }
    if (is_default !== undefined) {
      updates.push('is_default = @isDefault')
      params.isDefault = is_default ? 1 : 0
    }
    
    updates.push('updated_at = GETUTCDATE()')
    updates.push('updated_by = @user')
    params.user = user
    
    // Mark as not deployed since config changed
    updates.push('is_deployed = 0')
    
    await dbExecute(
      `UPDATE mds_meta.entity_view SET ${updates.join(', ')} WHERE id = @id`,
      params
    )
    
    logger.info({ viewId: id }, 'View updated')
    
    return NextResponse.json({
      message: 'View updated successfully'
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to update view')
    return NextResponse.json(
      { error: 'Failed to update view' },
      { status: 500 }
    )
  }
}

// DELETE /api/views?id=X - Delete a view
export async function DELETE(request: NextRequest) {
  logger.info('DELETE /api/views')
  
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }
    
    // Get view to check if deployed
    const views = await dbQuery<EntityView>(
      'SELECT * FROM mds_meta.entity_view WHERE id = @id',
      { id: parseInt(id) }
    )
    
    if (views.length === 0) {
      return NextResponse.json(
        { error: 'View not found' },
        { status: 404 }
      )
    }
    
    const view = views[0]
    
    // If view is deployed, drop it from database
    if (view.is_deployed) {
      try {
        await dbExecute(`DROP VIEW IF EXISTS mds_view.[${view.code}]`)
        logger.info({ code: view.code }, 'Dropped deployed view')
      } catch (dropError) {
        logger.warn({ error: dropError }, 'Failed to drop view (may not exist)')
      }
    }
    
    // Delete from config
    await dbExecute(
      'DELETE FROM mds_meta.entity_view WHERE id = @id',
      { id: parseInt(id) }
    )
    
    logger.info({ viewId: id }, 'View deleted')
    
    return NextResponse.json({
      message: 'View deleted successfully'
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to delete view')
    return NextResponse.json(
      { error: 'Failed to delete view' },
      { status: 500 }
    )
  }
}
