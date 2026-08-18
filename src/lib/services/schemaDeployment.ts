import { dbQuery, dbExecute } from '@/lib/db-server'
import { logger } from '@/lib/logger'

// UPSERT schema_deployment for entity (only if model is active) - queues the
// entity for schema (re)deployment whenever its structure changes. Was
// previously duplicated verbatim across 5 route files (models, entities x2,
// attributes x2) - single copy now.
export async function upsertSchemaDeployment(entityId: number) {
  const modelCheck = await dbQuery<{ model_status: string }>(
    `SELECT m.status AS model_status
     FROM mds_meta.entity e
     JOIN mds_meta.model m ON m.id = e.model_id
     WHERE e.id = @entityId`,
    { entityId }
  )

  if (modelCheck.length > 0 && modelCheck[0].model_status === 'active') {
    await dbExecute(
      `MERGE mds_meta.schema_deployment AS target
       USING (SELECT @entityId AS entity_id) AS source
       ON target.entity_id = source.entity_id
       WHEN MATCHED THEN
         UPDATE SET updated_at = GETUTCDATE(), status = 'pending'
       WHEN NOT MATCHED THEN
         INSERT (entity_id, status, created_at) VALUES (@entityId, 'pending', GETUTCDATE());`,
      { entityId }
    )
    logger.info({ entityId }, 'Created/updated schema_deployment entry')
  }
}

// Entities created while their model was still 'draft' never get a
// schema_deployment row (upsertSchemaDeployment above only fires when the
// model is already 'active' at entity-creation time). When the model later
// becomes active, sweep up anything that was skipped - otherwise those
// entities stay stuck: status 'draft' in the UI, but invisible on /deploy's
// schema tab forever, since nothing ever retries the upsert for them.
export async function backfillSchemaDeploymentForModel(modelId: number) {
  await dbExecute(
    `INSERT INTO mds_meta.schema_deployment (entity_id, status, created_at)
     SELECT e.id, 'pending', GETUTCDATE()
     FROM mds_meta.entity e
     WHERE e.model_id = @modelId
       AND NOT EXISTS (SELECT 1 FROM mds_meta.schema_deployment sd WHERE sd.entity_id = e.id)`,
    { modelId }
  )
}
