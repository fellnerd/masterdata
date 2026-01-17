import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '@/lib/logger'

// Types
interface Attribute {
  attr_id: string
  entity_id: string
  attr_name: string
  attr_label: string | null
  data_type: string
  is_required: boolean
  is_unique: boolean
  default_value: string | null
  sort_order: number
  validation_regex: string | null
  created_at: string
}

// Supported data types for attributes
const DATA_TYPES = [
  'INT',
  'BIGINT',
  'DECIMAL(18,2)',
  'NVARCHAR(50)',
  'NVARCHAR(100)',
  'NVARCHAR(200)',
  'NVARCHAR(255)',
  'NVARCHAR(500)',
  'NVARCHAR(MAX)',
  'BIT',
  'DATE',
  'DATETIME2',
  'UNIQUEIDENTIFIER',
]

// GET /api/entities/[entityId]/attributes - List attributes for entity
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'GET /api/entities/[entityId]/attributes')
  
  try {
    // Mock attributes
    const attributes: Attribute[] = [
      { attr_id: 'attr-001', entity_id: entityId, attr_name: 'customer_id', attr_label: 'Customer ID', data_type: 'INT', is_required: true, is_unique: true, default_value: null, sort_order: 1, validation_regex: null, created_at: '2023-01-16T10:00:00Z' },
      { attr_id: 'attr-002', entity_id: entityId, attr_name: 'customer_name', attr_label: 'Name', data_type: 'NVARCHAR(200)', is_required: true, is_unique: false, default_value: null, sort_order: 2, validation_regex: null, created_at: '2023-01-16T10:00:00Z' },
      { attr_id: 'attr-003', entity_id: entityId, attr_name: 'email', attr_label: 'Email', data_type: 'NVARCHAR(255)', is_required: false, is_unique: true, default_value: null, sort_order: 3, validation_regex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', created_at: '2023-01-16T10:00:00Z' },
      { attr_id: 'attr-004', entity_id: entityId, attr_name: 'phone', attr_label: 'Phone', data_type: 'NVARCHAR(50)', is_required: false, is_unique: false, default_value: null, sort_order: 4, validation_regex: null, created_at: '2023-01-16T10:00:00Z' },
      { attr_id: 'attr-005', entity_id: entityId, attr_name: 'status', attr_label: 'Status', data_type: 'NVARCHAR(20)', is_required: true, is_unique: false, default_value: 'active', sort_order: 5, validation_regex: null, created_at: '2023-01-16T10:00:00Z' },
    ]
    
    return NextResponse.json({
      data: attributes,
      total: attributes.length,
      data_types: DATA_TYPES, // Send available data types for form dropdowns
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to fetch attributes')
    return NextResponse.json(
      { error: 'Failed to fetch attributes' },
      { status: 500 }
    )
  }
}

// POST /api/entities/[entityId]/attributes - Create new attribute
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'POST /api/entities/[entityId]/attributes')
  
  try {
    const body = await request.json()
    const { 
      name, 
      label, 
      data_type, 
      is_required = false, 
      is_unique = false,
      default_value,
      validation_regex,
      sort_order 
    } = body
    
    if (!name || !data_type) {
      return NextResponse.json(
        { error: 'Attribute name and data type are required' },
        { status: 400 }
      )
    }
    
    if (!DATA_TYPES.includes(data_type)) {
      return NextResponse.json(
        { error: `Invalid data type. Must be one of: ${DATA_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    
    const newAttribute: Attribute = {
      attr_id: uuidv4(),
      entity_id: entityId,
      attr_name: name,
      attr_label: label || null,
      data_type,
      is_required,
      is_unique,
      default_value: default_value || null,
      sort_order: sort_order || 999,
      validation_regex: validation_regex || null,
      created_at: new Date().toISOString(),
    }
    
    // TODO: Insert into database
    // await execute(`
    //   INSERT INTO mds_meta.attribute (attr_id, entity_id, attr_name, attr_label, data_type, is_required, is_unique, default_value, sort_order, validation_regex)
    //   VALUES (@attr_id, @entity_id, @attr_name, @attr_label, @data_type, @is_required, @is_unique, @default_value, @sort_order, @validation_regex)
    // `, newAttribute)
    
    return NextResponse.json(newAttribute, { status: 201 })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to create attribute')
    return NextResponse.json(
      { error: 'Failed to create attribute' },
      { status: 500 }
    )
  }
}

// PUT /api/entities/[entityId]/attributes - Batch update attributes (reorder)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await params
  logger.info({ entityId }, 'PUT /api/entities/[entityId]/attributes (batch)')
  
  try {
    const body = await request.json()
    const { attributes } = body // Array of { attr_id, sort_order }
    
    if (!Array.isArray(attributes)) {
      return NextResponse.json(
        { error: 'Attributes array is required' },
        { status: 400 }
      )
    }
    
    // TODO: Batch update in database
    // for (const attr of attributes) {
    //   await execute('UPDATE mds_meta.attribute SET sort_order = @sort_order WHERE attr_id = @attr_id', attr)
    // }
    
    return NextResponse.json({ 
      success: true, 
      updated: attributes.length 
    })
  } catch (error) {
    logger.error({ error, entityId }, 'Failed to update attributes')
    return NextResponse.json(
      { error: 'Failed to update attributes' },
      { status: 500 }
    )
  }
}
