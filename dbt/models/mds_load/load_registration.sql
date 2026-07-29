{{
  config(
    materialized='incremental',
    schema='mds_load',
    alias='registration',
    incremental_strategy='merge',
    unique_key='business_key_hash',
    on_schema_change='sync_all_columns',
    as_columnstore=false,
    post_hook=[
      "-- Update staged_record status to 'loaded'",
      "UPDATE sr SET sr.status = 'loaded' FROM mds_stage.staged_record sr INNER JOIN mds_stage.[commit] c ON sr.commit_id = c.id WHERE sr.entity_id = 1 AND sr.status = 'committed' AND c.status = 'approved'{% if var('deploy_commit_ids', none) %} AND c.id IN ({{ var('deploy_commit_ids')|join(',') }}){% endif %}",
      "-- Update commit status to 'loaded'",
      "UPDATE mds_stage.[commit] SET status = 'loaded', deployed_at = GETUTCDATE() WHERE status = 'approved' AND entity_id = 1{% if var('deploy_commit_ids', none) %} AND id IN ({{ var('deploy_commit_ids')|join(',') }}){% endif %}"
    ]
  )
}}

{#
  =====================================================
  MDS Load: Registration
  =====================================================
  
  Entity Code: registration
  Entity ID:   1
  Generated:   2026-07-29T18:45:58.854578
  
  Source: mds_stage.staged_record (JSON data)
  Target: mds_load.registration (flache Tabelle)
  
  WICHTIG: Diese Tabelle enthält immer nur den LETZTGÜLTIGEN
  Stand pro Business Key. Bei Updates wird die existierende
  Zeile überschrieben (MERGE auf business_key_hash).
  
  Die vollständige Historie wird im Master (mds_master.registration)
  via SCD2 geführt.
  =====================================================
#}

{% if is_incremental() %}

-- Incremental: Nur approved Commits laden (MERGE - überschreibt bei gleichem BK)
SELECT
    sr.business_key_hash,
    sr.business_key,
    JSON_VALUE(sr.data, '$.name') AS name,
    JSON_VALUE(sr.data, '$.value') AS value,
    JSON_VALUE(sr.data, '$.embedded_url') AS embedded_url,
    sr.commit_id,
    sr.operation,
    'MDS' AS source_system,
    CAST(sr.id AS NVARCHAR(255)) AS source_id,
    CAST(0 AS BIT) AS is_processed,
    GETUTCDATE() AS created_at,
    CAST(NULL AS DATETIME2) AS processed_at
FROM mds_stage.staged_record sr
INNER JOIN mds_stage.[commit] c ON sr.commit_id = c.id
WHERE sr.entity_id = 1
  AND sr.status = 'committed'
  AND c.status = 'approved'
  {% if var('deploy_commit_ids', none) %} AND c.id IN ({{ var('deploy_commit_ids')|join(',') }}){% endif %}

{% else %}

-- Full Refresh: Alle committed Records laden (neueste pro BK)
WITH ranked AS (
  SELECT
    sr.business_key_hash,
    sr.business_key,
    JSON_VALUE(sr.data, '$.name') AS name,
    JSON_VALUE(sr.data, '$.value') AS value,
    JSON_VALUE(sr.data, '$.embedded_url') AS embedded_url,
    sr.commit_id,
    sr.operation,
    'MDS' AS source_system,
    CAST(sr.id AS NVARCHAR(255)) AS source_id,
    CAST(0 AS BIT) AS is_processed,
    GETUTCDATE() AS created_at,
    CAST(NULL AS DATETIME2) AS processed_at,
    ROW_NUMBER() OVER (PARTITION BY sr.business_key_hash ORDER BY sr.id DESC) AS rn
  FROM mds_stage.staged_record sr
  INNER JOIN mds_stage.[commit] c ON sr.commit_id = c.id
  WHERE sr.entity_id = 1
    AND sr.status IN ('committed', 'loaded')
    AND c.status IN ('approved', 'loaded', 'deployed')
)
SELECT 
  business_key_hash, business_key, 
  name, value, embedded_url,
  commit_id, operation, source_system, source_id, is_processed, created_at, processed_at
FROM ranked WHERE rn = 1

{% endif %}
