{% macro import_from_datavault(entity_id) %}
{#
  Import-Macro für Data Vault → MDS
  
  Liest Import-Mapping aus mds_meta.entity und führt Full-Replace durch:
  1. Löscht bestehende staged_record für entity_id
  2. Fügt neue Records aus Data Vault Quelle ein
  
  Aufruf: dbt run-operation import_from_datavault --args '{entity_id: 1}'
#}

{% set entity_query %}
  SELECT 
    e.id,
    e.code,
    e.name,
    e.import_source_object,
    e.import_column_mapping,
    e.import_filter,
    a.code as attr_code,
    a.name as attr_name,
    a.data_type,
    a.is_business_key
  FROM mds_meta.entity e
  LEFT JOIN mds_meta.attribute a ON a.entity_id = e.id
  WHERE e.id = {{ entity_id }}
  ORDER BY a.sort_order
{% endset %}

{% set entity_result = run_query(entity_query) %}

{% if entity_result | length == 0 %}
  {{ exceptions.raise_compiler_error("Entity with id " ~ entity_id ~ " not found") }}
{% endif %}

{% set entity = entity_result[0] %}
{% set source_object = entity['import_source_object'] %}

{% if not source_object %}
  {{ exceptions.raise_compiler_error("Entity " ~ entity_id ~ " has no import_source_object configured") }}
{% endif %}

{# Parse column mapping JSON #}
{% set column_mapping_raw = entity['import_column_mapping'] %}
{% if column_mapping_raw %}
  {% set column_mapping = fromjson(column_mapping_raw) %}
{% else %}
  {% set column_mapping = {} %}
{% endif %}

{# Build attributes list #}
{% set attributes = [] %}
{% for row in entity_result %}
  {% if row['attr_code'] %}
    {% do attributes.append({
      'code': row['attr_code'],
      'name': row['attr_name'],
      'data_type': row['data_type'],
      'is_business_key': row['is_business_key']
    }) %}
  {% endif %}
{% endfor %}

{{ log("Importing from " ~ source_object ~ " into entity " ~ entity['code'], info=True) }}
{{ log("Found " ~ attributes | length ~ " attributes", info=True) }}

{# Step 1: Delete existing staged records for this entity #}
{% set delete_sql %}
DELETE FROM mds_stage.staged_record 
WHERE entity_id = {{ entity_id }}
{% endset %}

{{ log("Deleting existing staged records...", info=True) }}
{% do run_query(delete_sql) %}

{# Step 2: Build SELECT columns from mapping #}
{% set select_columns = [] %}
{% set json_fields = [] %}

{% for attr in attributes %}
  {% set source_col = column_mapping.get(attr.code, attr.code) %}
  {# Build JSON field: "attr_code": "value" - simpler approach #}
  {% do json_fields.append("'\"" ~ attr.code ~ "\": \"' + ISNULL(CAST(" ~ source_col ~ " AS NVARCHAR(MAX)), 'null') + '\"'") %}
{% endfor %}

{# Build business key concatenation for hashing #}
{% set bk_parts = [] %}
{% for attr in attributes %}
  {% if attr.is_business_key %}
    {% set source_col = column_mapping.get(attr.code, attr.code) %}
    {% do bk_parts.append("ISNULL(CAST(" ~ source_col ~ " AS NVARCHAR(MAX)), N'')") %}
  {% endif %}
{% endfor %}

{% if bk_parts | length == 0 %}
  {{ exceptions.raise_compiler_error("Entity has no business key attributes defined") }}
{% endif %}

{% set bk_concat = bk_parts | join(" + '|' + ") %}

{# Build filter condition #}
{% set filter_condition = entity['import_filter'] if entity['import_filter'] else '1=1' %}

{# Step 3: Insert new records #}
{% set insert_sql %}
INSERT INTO mds_stage.staged_record (
  entity_id,
  business_key_hash,
  business_key,
  payload,
  data,
  operation,
  status,
  source_system,
  created_at,
  created_by
)
SELECT
  {{ entity_id }} AS entity_id,
  CONVERT(CHAR(64), HASHBYTES('SHA2_256', {{ bk_concat }}), 2) AS business_key_hash,
  {{ bk_concat }} AS business_key,
  '{' + {{ json_fields | join(" + ', ' + ") }} + '}' AS payload,
  '{' + {{ json_fields | join(" + ', ' + ") }} + '}' AS data,
  'UPSERT' AS operation,
  'PENDING' AS status,
  'DataVault:{{ source_object }}' AS source_system,
  GETUTCDATE() AS created_at,
  'dbt_import' AS created_by
FROM {{ source_object }}
WHERE {{ filter_condition }}
{% endset %}

{{ log("Inserting records from " ~ source_object ~ "...", info=True) }}
{% do run_query(insert_sql) %}

{# Get count of imported records #}
{% set count_query %}
SELECT COUNT(*) as cnt FROM mds_stage.staged_record WHERE entity_id = {{ entity_id }}
{% endset %}
{% set count_result = run_query(count_query) %}
{% set record_count = count_result[0]['cnt'] %}

{{ log("Successfully imported " ~ record_count ~ " records from " ~ source_object, info=True) }}

{# Update last_import_at on entity #}
{% set update_entity %}
UPDATE mds_meta.entity 
SET last_import_at = GETUTCDATE(),
    updated_at = GETUTCDATE()
WHERE id = {{ entity_id }}
{% endset %}
{% do run_query(update_entity) %}

{{ return({'success': true, 'records_imported': record_count, 'source': source_object}) }}

{% endmacro %}
