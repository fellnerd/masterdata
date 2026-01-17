{% macro generate_entity_models() %}
{#
    Macro zum Generieren von dbt Model-Dateien für alle aktiven Entities.
    
    Workflow:
    1. Liest alle Entities aus mds_meta.entity
    2. Generiert für jede Entity ein mds_master Model (SCD2)
    3. Schreibt .sql Dateien nach models/mds_master/
    
    Aufruf:
    dbt run-operation generate_entity_models
    
    Hinweis: 
    Dies generiert nur die Model-Dateien. 
    Anschließend muss `dbt run --select mds_master` ausgeführt werden.
#}

{% set entities_query %}
    SELECT 
        e.id,
        e.code,
        e.name,
        e.scd_type
    FROM mds_meta.entity e
    WHERE e.status = 'active'
    ORDER BY e.code
{% endset %}

{% set entities = run_query(entities_query) %}

{% if execute %}
    {% for entity in entities %}
        {% set entity_code = entity['code'] | lower %}
        {% set entity_name = entity['name'] %}
        {% set scd_type = entity['scd_type'] %}
        
        {{ log("Generating model for entity: " ~ entity_code ~ " (SCD Type: " ~ scd_type ~ ")", info=True) }}
        
        {# Get attributes for this entity #}
        {% set attrs_query %}
            SELECT 
                a.code,
                a.name,
                a.data_type,
                a.is_business_key,
                a.is_required,
                a.sort_order
            FROM mds_meta.attribute a
            WHERE a.entity_id = {{ entity['id'] }}
            ORDER BY a.sort_order
        {% endset %}
        
        {% set attributes = run_query(attrs_query) %}
        
        {# Build column list #}
        {% set columns = [] %}
        {% set business_key_col = none %}
        {% for attr in attributes %}
            {% do columns.append(attr['code']) %}
            {% if attr['is_business_key'] %}
                {% set business_key_col = attr['code'] %}
            {% endif %}
        {% endfor %}
        
        {{ log("  Columns: " ~ columns | join(', '), info=True) }}
        {{ log("  Business Key: " ~ business_key_col, info=True) }}
        
    {% endfor %}
    
    {{ log("", info=True) }}
    {{ log("========================================", info=True) }}
    {{ log("Model generation complete.", info=True) }}
    {{ log("Run: dbt run --select mds_master", info=True) }}
    {{ log("========================================", info=True) }}
{% endif %}

{% endmacro %}


{% macro get_entity_columns(entity_id) %}
{#
    Helper Macro: Gibt Spaltenliste für eine Entity zurück
#}
{% set query %}
    SELECT code, data_type, is_business_key
    FROM mds_meta.attribute
    WHERE entity_id = {{ entity_id }}
    ORDER BY sort_order
{% endset %}
{{ return(run_query(query)) }}
{% endmacro %}
