{{
  config(
    materialized='incremental',
    schema='mds_master',
    alias='company',
    incremental_strategy='append',
    on_schema_change='sync_all_columns',
    as_columnstore=false,
    pre_hook=[
      "{% if is_incremental() %}
      -- Close existing current records that will be updated
      UPDATE mds_master.company
      SET valid_to = GETUTCDATE(), 
          is_current = 0, 
          updated_at = GETUTCDATE(), 
          updated_by = 'dbt'
      WHERE is_current = 1 
        AND business_key IN (
          SELECT business_key 
          FROM mds_load.company 
          WHERE is_processed = 0 
            AND operation IN ('UPDATE', 'DELETE', 'INSERT')
            AND business_key IN (SELECT business_key FROM mds_master.company WHERE is_current = 1)
        )
      {% endif %}"
    ],
    post_hook=[
      "-- Mark load records as processed",
      "UPDATE mds_load.company SET is_processed = 1, processed_at = GETUTCDATE() WHERE is_processed = 0",
      "-- Update commit status to 'deployed' for all loaded commits",
      "UPDATE mds_stage.[commit] SET status = 'deployed' WHERE status = 'loaded' AND entity_id = 4",
      "-- Remove DELETE records from load (they should not appear in current state)",
      "DELETE FROM mds_load.company WHERE operation = 'DELETE'"
    ]
  )
}}

{#
  =====================================================
  MDS Master: Company
  =====================================================
  
  Entity Code: company
  Generated:   2026-01-16T19:35:26.610753
  
  Source: mds_load.company
  Target: mds_master.company (SCD2 historisiert)
  
  Business Key: company_id
  Columns: company_id, name
  =====================================================
#}

{% if is_incremental() %}

-- Incremental: Nur unverarbeitete Records aus Load-Tabelle
WITH source_data AS (
    SELECT 
        CAST(source_id AS BIGINT) AS load_id,
        business_key,
        business_key_hash,
        operation,
        company_id,
        name,
        commit_id,
        source_system,
        source_id,
        created_at
    FROM mds_load.company
    WHERE is_processed = 0
),

-- Change Detection
changes AS (
    SELECT 
        s.*,
        t.business_key AS existing_business_key,
        CASE 
            WHEN t.business_key IS NULL THEN 'NEW'
            WHEN s.operation = 'DELETE' THEN 'DELETE'
            WHEN s.operation = 'UPDATE' OR (
                COALESCE(CAST(s.company_id AS NVARCHAR(MAX)), '') != COALESCE(CAST(t.company_id AS NVARCHAR(MAX)), '') OR
                COALESCE(CAST(s.name AS NVARCHAR(MAX)), '') != COALESCE(CAST(t.name AS NVARCHAR(MAX)), '')
            ) THEN 'CHANGED'
            ELSE 'NO_CHANGE'
        END AS change_type
    FROM source_data s
    LEFT JOIN {{ this }} t 
        ON s.business_key = t.business_key 
        AND t.is_current = 1
)

-- Insert new versions
SELECT
    business_key,
    business_key_hash,
    company_id,
        name,
    created_at AS valid_from,
    CAST('9999-12-31' AS DATETIME2) AS valid_to,
    CAST(1 AS BIT) AS is_current,
    CASE WHEN operation = 'DELETE' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS is_deleted,
    commit_id,
    source_system,
    source_id,
    CAST(load_id AS BIGINT) AS source_load_id,
    GETUTCDATE() AS created_at,
    'dbt' AS created_by,
    CAST(NULL AS DATETIME2) AS updated_at,
    CAST(NULL AS NVARCHAR(100)) AS updated_by
FROM changes
WHERE change_type IN ('NEW', 'CHANGED', 'DELETE')

{% else %}

-- Full Refresh: Alle Records
SELECT
    business_key,
    business_key_hash,
    company_id,
        name,
    created_at AS valid_from,
    CAST('9999-12-31' AS DATETIME2) AS valid_to,
    CAST(1 AS BIT) AS is_current,
    CASE WHEN operation = 'DELETE' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS is_deleted,
    commit_id,
    source_system,
    source_id,
    CAST(source_id AS BIGINT) AS source_load_id,
    GETUTCDATE() AS created_at,
    'dbt' AS created_by,
    CAST(NULL AS DATETIME2) AS updated_at,
    CAST(NULL AS NVARCHAR(100)) AS updated_by
FROM mds_load.company
WHERE is_processed = 0

{% endif %}
