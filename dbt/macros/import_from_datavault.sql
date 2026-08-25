{% macro import_from_datavault(entity_id) %}
{#
  Import-Macro für Data Vault → MDS

  Liest Import-Mapping aus mds_meta.entity und liest Daten aus der
  konfigurierten Quelle (import_source_object, z.B. 'vault_bmi.sat_werk__sauter'
  - liegt auf derselben DB-Instanz wie MDS selbst, kein Cross-Server-Zugriff).

  Ein Attribut gilt nur dann als "sourced" (wird aus der Quelle gelesen), wenn
  seine (gemappte oder namensgleiche) Spalte tatsächlich in der Quelltabelle
  existiert (geprüft via INFORMATION_SCHEMA.COLUMNS). Alle anderen Attribute
  sind "Anreicherung" - werden nie aus der Quelle gelesen und vom Import nie
  überschrieben.

  Zwei Modi, gesteuert über entity.import_tracking_column:

  - NICHT gesetzt: klassischer Full Refresh - alle staged_record-Zeilen
    dieser Entity werden gelöscht und aus der Quelle neu aufgebaut (nur
    sourced-Attribute; Anreicherung geht dabei verloren, das ist bekannt und
    akzeptiert).

  - Gesetzt (z.B. eine Satellite-hashdiff-Spalte, oder jede andere Spalte,
    die sich bei einer echten Änderung ändert): pro Business Key wird
    verglichen, ob sich der Tracking-Wert seit dem letzten Import geändert
    hat.
      * neuer Business Key             -> einfügen
      * Tracking-Wert unverändert      -> Zeile komplett unangetastet lassen
                                           (Anreicherung bleibt erhalten)
      * Tracking-Wert geändert         -> nur die sourced-Felder im
                                           bestehenden data-JSON per
                                           JSON_MODIFY aktualisieren,
                                           Anreicherung bleibt erhalten;
                                           bereits geladene/committete Zeilen
                                           fallen auf 'PENDING' zurück
                                           (gleiche Konvention wie bei
                                           manuellen Edits über die API)
      * Business Key in Quelle verschwunden -> falls noch PENDING: löschen;
                                           sonst als DELETE-Operation markiert

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
    e.import_tracking_column,
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

{% if '.' not in source_object %}
  {{ exceptions.raise_compiler_error("import_source_object must be schema.table, got: " ~ source_object) }}
{% endif %}
{% set source_schema = source_object.split('.')[0] %}
{% set source_table_name = source_object.split('.')[1] %}

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

{# Which columns actually exist in the source table - decides sourced vs enrichment #}
{% set real_columns_query %}
  SELECT UPPER(COLUMN_NAME) AS col FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '{{ source_schema }}' AND TABLE_NAME = '{{ source_table_name }}'
{% endset %}
{% set real_columns_result = run_query(real_columns_query) %}
{% set real_columns = [] %}
{% for row in real_columns_result %}
  {% do real_columns.append(row['col']) %}
{% endfor %}

{% if real_columns | length == 0 %}
  {{ exceptions.raise_compiler_error("Source object not found or has no columns: " ~ source_object) }}
{% endif %}

{% set sourced_attributes = [] %}
{% set enrichment_attributes = [] %}
{% for attr in attributes %}
  {% set source_col = column_mapping.get(attr.code, attr.code) %}
  {% if source_col.upper() in real_columns %}
    {% do sourced_attributes.append({'code': attr.code, 'source_col': source_col, 'is_business_key': attr.is_business_key}) %}
  {% else %}
    {% do enrichment_attributes.append(attr.code) %}
    {% if attr.is_business_key %}
      {{ exceptions.raise_compiler_error("Business key attribute '" ~ attr.code ~ "' has no matching source column ('" ~ source_col ~ "' not found in " ~ source_object ~ ") - business key attributes must be sourced, they can't be enrichment-only") }}
    {% endif %}
  {% endif %}
{% endfor %}

{% if sourced_attributes | length == 0 %}
  {{ exceptions.raise_compiler_error("No attribute of entity " ~ entity_id ~ " matches a column in " ~ source_object ~ " - nothing to import") }}
{% endif %}

{# Business key concatenation (sourced attributes only - enforced above) #}
{% set bk_parts = [] %}
{% for attr in sourced_attributes %}
  {% if attr.is_business_key %}
    {% do bk_parts.append("ISNULL(CAST(" ~ attr.source_col ~ " AS NVARCHAR(MAX)), N'')") %}
  {% endif %}
{% endfor %}
{% if bk_parts | length == 0 %}
  {{ exceptions.raise_compiler_error("Entity has no business key attributes defined") }}
{% endif %}
{% set bk_concat = bk_parts | join(" + '|' + ") %}

{% set filter_condition = entity['import_filter'] if entity['import_filter'] else '1=1' %}

{# Tracking column: only used if configured AND it actually exists in source #}
{% set tracking_column_raw = entity['import_tracking_column'] %}
{% set use_tracking = false %}
{% if tracking_column_raw and tracking_column_raw.upper() in real_columns %}
  {% set use_tracking = true %}
{% endif %}

{{ log("Importing from " ~ source_object ~ " into entity " ~ entity['code'], info=True) }}
{{ log("Sourced attributes: " ~ (sourced_attributes | map(attribute='code') | join(', ')), info=True) }}
{{ log("Enrichment attributes (never touched by import): " ~ (enrichment_attributes | join(', ') if enrichment_attributes | length > 0 else '(none)'), info=True) }}
{{ log("Tracking mode: " ~ ('enabled (' ~ tracking_column_raw ~ ')' if use_tracking else 'disabled - full refresh'), info=True) }}

{# Shared CTE selecting the current source rows: business key, tracking
   value, and one column per sourced attribute (val_<code>). Reused
   verbatim across several separate queries below - CTEs don't persist
   across statements, so it's a Jinja variable instead of a temp table. #}
{% set source_cte %}
WITH source_rows AS (
  SELECT
    CONVERT(CHAR(64), HASHBYTES('SHA2_256', {{ bk_concat }}), 2) AS business_key_hash,
    {{ bk_concat }} AS business_key,
    {% if use_tracking %}
    CAST({{ tracking_column_raw }} AS NVARCHAR(500)) AS tracking_value,
    {% else %}
    CAST(NULL AS NVARCHAR(500)) AS tracking_value,
    {% endif %}
    {% for attr in sourced_attributes %}
    ISNULL(CAST({{ attr.source_col }} AS NVARCHAR(MAX)), 'null') AS val_{{ attr.code }}{{ "," if not loop.last }}
    {% endfor %}
  FROM {{ source_object }}
  WHERE {{ filter_condition }}
)
{% endset %}

{# JSON payload expression for a brand-new row: '{"attr1":"..","attr2":".."}'.
   Always references the source CTE aliased as `sr` - every query below
   that uses this aliases it that way, so this one expression works
   everywhere without any string-rewriting.

   sr.val_<code> is wrapped in STRING_ESCAPE(..., 'json') here - free-text
   source values (e.g. long NL product descriptions) can contain a literal
   quote, backslash, or control character (embedded newlines are common),
   which without escaping produces invalid JSON that breaks every reader of
   mds_stage.staged_record.data, not just this row. Only applied at this
   plain string-concatenation call site, NOT to the merge_ns.expr below -
   JSON_MODIFY() encodes its replacement value itself, so escaping sr.val_
   again there would double-escape it. #}
{% set json_parts = [] %}
{% for attr in sourced_attributes %}
  {% do json_parts.append("'\"" ~ attr.code ~ "\":\"' + STRING_ESCAPE(sr.val_" ~ attr.code ~ ", 'json') + '\"'") %}
{% endfor %}
{% set new_payload_expr = "'{' + " ~ (json_parts | join(" + ',' + ")) ~ " + '}'" %}

{# Nested JSON_MODIFY expression that updates only sourced keys in an
   existing data blob, leaving any enrichment keys untouched. Also always
   against `sr` (source CTE alias) and `t` (target table alias). #}
{% set merge_ns = namespace(expr = 't.data') %}
{% for attr in sourced_attributes %}
  {% set merge_ns.expr = "JSON_MODIFY(" ~ merge_ns.expr ~ ", '$." ~ attr.code ~ "', sr.val_" ~ attr.code ~ ")" %}
{% endfor %}

{% if not use_tracking %}

  {# ===== Full refresh mode (no tracking column configured) ===== #}
  {% set delete_sql %}
  DELETE FROM mds_stage.staged_record WHERE entity_id = {{ entity_id }}
  {% endset %}
  {{ log("Deleting existing staged records...", info=True) }}
  {% do run_query(delete_sql) %}

  {% set insert_sql %}
  {{ source_cte }}
  INSERT INTO mds_stage.staged_record (
    entity_id, business_key_hash, business_key, payload, data, operation,
    status, source_system, source_tracking_value, created_at, created_by
  )
  SELECT
    {{ entity_id }}, sr.business_key_hash, sr.business_key,
    {{ new_payload_expr }}, {{ new_payload_expr }},
    'UPSERT', 'PENDING', 'DataVault:{{ source_object }}', NULL, GETUTCDATE(), 'dbt_import'
  FROM source_rows sr
  {% endset %}
  {{ log("Inserting records from " ~ source_object ~ "...", info=True) }}
  {% do run_query(insert_sql) %}

{% else %}

  {# ===== Tracking mode: insert new / merge changed / skip unchanged / handle vanished ===== #}

  {% set insert_sql %}
  {{ source_cte }}
  INSERT INTO mds_stage.staged_record (
    entity_id, business_key_hash, business_key, payload, data, operation,
    status, source_system, source_tracking_value, created_at, created_by
  )
  SELECT
    {{ entity_id }}, sr.business_key_hash, sr.business_key,
    {{ new_payload_expr }}, {{ new_payload_expr }},
    'UPSERT', 'PENDING', 'DataVault:{{ source_object }}', sr.tracking_value, GETUTCDATE(), 'dbt_import'
  FROM source_rows sr
  WHERE NOT EXISTS (
    SELECT 1 FROM mds_stage.staged_record existing
    WHERE existing.entity_id = {{ entity_id }} AND existing.business_key_hash = sr.business_key_hash
  )
  {% endset %}
  {{ log("Inserting new records...", info=True) }}
  {% do run_query(insert_sql) %}

  {% set update_sql %}
  {{ source_cte }}
  UPDATE t SET
    t.previous_data = t.data,
    t.data = {{ merge_ns.expr }},
    t.payload = {{ merge_ns.expr }},
    t.source_tracking_value = sr.tracking_value,
    t.operation = 'UPDATE',
    t.status = 'PENDING',
    t.commit_id = NULL
  FROM mds_stage.staged_record t
  INNER JOIN source_rows sr ON sr.business_key_hash = t.business_key_hash
  WHERE t.entity_id = {{ entity_id }}
    AND (t.source_tracking_value IS NULL OR t.source_tracking_value <> sr.tracking_value)
  {% endset %}
  {{ log("Updating changed records (tracking value differs)...", info=True) }}
  {% do run_query(update_sql) %}

  {% set delete_pending_sql %}
  {{ source_cte }}
  DELETE FROM mds_stage.staged_record
  WHERE entity_id = {{ entity_id }}
    AND status = 'PENDING'
    AND business_key_hash NOT IN (SELECT business_key_hash FROM source_rows)
  {% endset %}
  {{ log("Removing still-pending records no longer in source...", info=True) }}
  {% do run_query(delete_pending_sql) %}

  {% set mark_deleted_sql %}
  {{ source_cte }}
  UPDATE mds_stage.staged_record
  SET previous_data = data, operation = 'DELETE', status = 'PENDING', commit_id = NULL
  WHERE entity_id = {{ entity_id }}
    AND status <> 'PENDING'
    AND business_key_hash NOT IN (SELECT business_key_hash FROM source_rows)
  {% endset %}
  {{ log("Flagging DELETE for already-loaded records no longer in source...", info=True) }}
  {% do run_query(mark_deleted_sql) %}

{% endif %}

{% set count_query %}
SELECT COUNT(*) as cnt FROM mds_stage.staged_record WHERE entity_id = {{ entity_id }}
{% endset %}
{% set count_result = run_query(count_query) %}
{% set record_count = count_result[0]['cnt'] %}

{{ log("Successfully imported from " ~ source_object ~ " - " ~ record_count ~ " staged record(s) total for entity", info=True) }}

{% set update_entity %}
UPDATE mds_meta.entity
SET last_import_at = GETUTCDATE(),
    updated_at = GETUTCDATE()
WHERE id = {{ entity_id }}
{% endset %}
{% do run_query(update_entity) %}

{{ return({'success': true, 'records_total': record_count, 'source': source_object, 'tracking_enabled': use_tracking}) }}

{% endmacro %}
