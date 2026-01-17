{{
  config(
    materialized='incremental',
    schema='mds_load',
    alias='company',
    incremental_strategy='merge',
    unique_key='business_key_hash',
    on_schema_change='sync_all_columns',
    as_columnstore=false,
    post_hook=[
      "-- Update staged_record status to 'loaded'",
      "UPDATE sr SET sr.status = 'loaded' FROM mds_stage.staged_record sr INNER JOIN mds_stage.[commit] c ON sr.commit_id = c.id WHERE sr.entity_id = 4 AND sr.status = 'committed' AND c.status = 'approved'",
      "-- Update commit status to 'loaded'",
      "UPDATE mds_stage.[commit] SET status = 'loaded', deployed_at = GETUTCDATE() WHERE status = 'approved' AND entity_id = 4"
    ]
  )
}}

{#
  =====================================================
  MDS Load: Company
  =====================================================
  
  Entity Code: company
  Entity ID:   4
  Generated:   2026-01-16T19:35:26.610489
  
  Source: mds_stage.staged_record (JSON data)
  Target: mds_load.company (flache Tabelle)
  
  WICHTIG: Diese Tabelle enthält immer nur den LETZTGÜLTIGEN
  Stand pro Business Key. Bei Updates wird die existierende
  Zeile überschrieben (MERGE auf business_key_hash).
  
  Die vollständige Historie wird im Master (mds_master.company)
  via SCD2 geführt.
  =====================================================
#}

{% if is_incremental() %}

-- Incremental: Nur approved Commits laden (MERGE - überschreibt bei gleichem BK)
SELECT
    sr.business_key_hash,
    sr.business_key,
    JSON_VALUE(sr.data, '$.company_id') AS company_id,
    JSON_VALUE(sr.data, '$.name') AS name,
    sr.commit_id,
    sr.operation,
    'MDS' AS source_system,
    CAST(sr.id AS NVARCHAR(255)) AS source_id,
    CAST(0 AS BIT) AS is_processed,
    GETUTCDATE() AS created_at,
    CAST(NULL AS DATETIME2) AS processed_at
FROM mds_stage.staged_record sr
INNER JOIN mds_stage.[commit] c ON sr.commit_id = c.id
WHERE sr.entity_id = 4
  AND sr.status = 'committed'
  AND c.status = 'approved'

{% else %}

-- Full Refresh: Alle committed Records laden (neueste pro BK)
WITH ranked AS (
  SELECT
    sr.business_key_hash,
    sr.business_key,
    JSON_VALUE(sr.data, '$.company_id') AS company_id,
    JSON_VALUE(sr.data, '$.name') AS name,
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
  WHERE sr.entity_id = 4
    AND sr.status IN ('committed', 'loaded')
    AND c.status IN ('approved', 'loaded', 'deployed')
)
SELECT 
  business_key_hash, business_key, 
  company_id, name,
  commit_id, operation, source_system, source_id, is_processed, created_at, processed_at
FROM ranked WHERE rn = 1

{% endif %}
