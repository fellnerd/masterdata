import { NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { DbtModel } from '@/lib/dbt/config-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportSource {
  status: string
  models_json: string | null
}

// GET /api/settings/import-source/objects - Get available dbt objects
export async function GET() {
  logger.info('GET /api/settings/import-source/objects')
  
  try {
    const configs = await dbQuery<ImportSource>(
      `SELECT status, models_json FROM mds_meta.import_source WHERE name = 'default'`
    )
    
    if (configs.length === 0) {
      return NextResponse.json(
        { error: 'No import source configuration found' },
        { status: 404 }
      )
    }
    
    const config = configs[0]
    
    if (config.status !== 'connected') {
      return NextResponse.json(
        { error: 'Import source not connected', status: config.status },
        { status: 400 }
      )
    }
    
    if (!config.models_json) {
      return NextResponse.json(
        { error: 'No models available' },
        { status: 404 }
      )
    }
    
    const models: DbtModel[] = JSON.parse(config.models_json)
    
    // Group by type for easier UI consumption
    const grouped = {
      hubs: models.filter(m => m.type === 'hub'),
      satellites: models.filter(m => m.type === 'satellite'),
      links: models.filter(m => m.type === 'link'),
      staging: models.filter(m => m.type === 'staging'),
      marts: models.filter(m => m.type === 'mart' || m.type === 'view'),
      pits: models.filter(m => m.type === 'pit'),
      bridges: models.filter(m => m.type === 'bridge'),
      tables: models.filter(m => m.type === 'table')
    }
    
    return NextResponse.json({
      objects: models,
      grouped,
      count: models.length
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to get objects')
    return NextResponse.json(
      { error: 'Failed to get available objects' },
      { status: 500 }
    )
  }
}
