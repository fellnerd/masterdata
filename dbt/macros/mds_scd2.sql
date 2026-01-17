{# 
  =====================================================
  MDS SCD2 Macros
  =====================================================
  Macros für Slowly Changing Dimension Type 2 Logik
  =====================================================
#}

{# 
  Close existing current records for changed business keys (SCD2 pre-hook)
  This is called before the main incremental insert to close old versions
#}
{% macro mds_close_current_records(source_schema, source_table, target_schema, target_table) %}

UPDATE t
SET 
    t.valid_to = s.load_timestamp,
    t.is_current = 0,
    t.updated_at = GETUTCDATE(),
    t.updated_by = 'dbt'
FROM {{ target_schema }}.{{ target_table }} t
INNER JOIN {{ source_schema }}.{{ source_table }} s 
    ON t.business_key = s.business_key
WHERE t.is_current = 1
  AND s.is_processed = 0
  AND s.operation IN ('UPDATE', 'DELETE');

{% endmacro %}


{# 
  Generate DDL for MDS Master Table with SCD2 columns
  
  Args:
    entity_code: The entity code (e.g., 'customer')
    columns: List of column definitions [{name, type, nullable}]
#}
{% macro generate_mds_master_ddl(entity_code, columns) %}
{#
  Creates a master table with:
  - business_key (from entity business key attribute)
  - business_key_hash (SHA256 hash)
  - All entity attributes
  - SCD2 columns: valid_from, valid_to, is_current, is_deleted
  - Audit columns: source_load_id, created_at, created_by, updated_at, updated_by
#}

IF NOT EXISTS (SELECT * FROM sys.tables t 
               JOIN sys.schemas s ON t.schema_id = s.schema_id 
               WHERE s.name = 'mds_master' AND t.name = '{{ entity_code }}')
BEGIN
    CREATE TABLE mds_master.{{ entity_code }} (
        -- Business Key
        business_key NVARCHAR(500) NOT NULL,
        business_key_hash CHAR(64) NOT NULL,
        
        -- Entity Attributes
        {% for col in columns %}
        {{ col.name }} {{ col.type }}{% if col.nullable %} NULL{% else %} NOT NULL{% endif %},
        {% endfor %}
        
        -- SCD2 Columns
        valid_from DATETIME2 NOT NULL,
        valid_to DATETIME2 NOT NULL DEFAULT '9999-12-31',
        is_current BIT NOT NULL DEFAULT 1,
        is_deleted BIT NOT NULL DEFAULT 0,
        
        -- Audit Columns
        source_load_id BIGINT,
        created_at DATETIME NOT NULL DEFAULT GETUTCDATE(),
        created_by NVARCHAR(100) NOT NULL DEFAULT 'dbt',
        updated_at DATETIME2 NULL,
        updated_by NVARCHAR(100) NULL,
        
        -- Constraints
        CONSTRAINT PK_{{ entity_code }} PRIMARY KEY (business_key, valid_from)
    );
    
    -- Index for current records lookup
    CREATE NONCLUSTERED INDEX IX_{{ entity_code }}_current 
    ON mds_master.{{ entity_code }} (business_key, is_current) 
    WHERE is_current = 1;
    
    -- Index for hash lookup
    CREATE NONCLUSTERED INDEX IX_{{ entity_code }}_hash 
    ON mds_master.{{ entity_code }} (business_key_hash);
END

{% endmacro %}


{#
  Mark load records as processed after successful master table update
#}
{% macro mds_mark_processed(schema, table) %}

UPDATE {{ schema }}.{{ table }}
SET is_processed = 1
WHERE is_processed = 0;

{% endmacro %}
