import { NextRequest, NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ImportMapping {
  import_source_object: string | null
  import_column_mapping: Record<string, string> | null
  import_filter: string | null
  import_schedule: string | null
  last_import_at: string | null
}

// GET /api/entities/[entityId]/import-mapping - Get import configuration
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'GET /api/entities/[entityId]/import-mapping')
  
  try {
    const results = await dbQuery<ImportMapping>(
      `SELECT 
         import_source_object,
         import_column_mapping,
         import_filter,
         import_schedule,
         last_import_at
       FROM mds_meta.entity 
       WHERE id = @id`,
      { id: parseInt(entityId) }
    )
    
    if (results.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }
    
    const mapping = results[0]
    
    // Parse JSON column mapping if stored as string
    let columnMapping = mapping.import_column_mapping
    if (typeof columnMapping === 'string') {
      try {
        columnMapping = JSON.parse(columnMapping)
      } catch {
        columnMapping = null
      }
    }
    
    return NextResponse.json({
      data: {
        ...mapping,
        import_column_mapping: columnMapping
      }
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to fetch import mapping')
    return NextResponse.json(
      { error: 'Failed to fetch import mapping' },
      { status: 500 }
    )
  }
}

// PUT /api/entities/[entityId]/import-mapping - Update import configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'PUT /api/entities/[entityId]/import-mapping')
  
  try {
    const body = await request.json()
    const {
      import_source_object,
      import_column_mapping,
      import_filter,
      import_schedule
    } = body
    
    // Verify entity exists
    const existCheck = await dbQuery<{ id: number }>(
      'SELECT id FROM mds_meta.entity WHERE id = @id',
      { id: parseInt(entityId) }
    )
    
    if (existCheck.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }
    
    // Serialize column mapping to JSON
    const columnMappingJson = import_column_mapping 
      ? JSON.stringify(import_column_mapping)
      : null
    
    // Update import configuration
    await dbExecute(
      `UPDATE mds_meta.entity 
       SET 
         import_source_object = @import_source_object,
         import_column_mapping = @import_column_mapping,
         import_filter = @import_filter,
         import_schedule = @import_schedule,
         updated_at = GETUTCDATE()
       WHERE id = @id`,
      {
        id: parseInt(entityId),
        import_source_object: import_source_object || null,
        import_column_mapping: columnMappingJson,
        import_filter: import_filter || null,
        import_schedule: import_schedule || null
      }
    )
    
    logger.info({ entityId, import_source_object }, 'Updated import mapping')
    
    return NextResponse.json({
      success: true,
      message: 'Import mapping updated successfully'
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to update import mapping')
    return NextResponse.json(
      { error: 'Failed to update import mapping' },
      { status: 500 }
    )
  }
}
