import { NextResponse } from 'next/server'
import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEMP_DIR = path.join(os.tmpdir(), 'mds-dbt-source')

// POST /api/settings/import-source/disconnect - Remove cloned repo
export async function POST() {
  logger.info('POST /api/settings/import-source/disconnect')
  
  try {
    // Clean up temp directory
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true })
      logger.info('Removed temp directory')
    }
    
    // Update database
    await dbExecute(
      `UPDATE mds_meta.import_source 
       SET status = 'disconnected',
           local_path = NULL,
           project_name = NULL,
           models_json = NULL,
           error_message = NULL,
           updated_at = GETUTCDATE()
       WHERE name = 'default'`
    )
    
    return NextResponse.json({
      success: true,
      message: 'Disconnected from dbt project'
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to disconnect')
    return NextResponse.json(
      { error: 'Failed to disconnect from import source' },
      { status: 500 }
    )
  }
}
