{#
  =====================================================
  MDS Schema Generator Macro
  =====================================================
  Generiert das initiale MDS Schema bei Container-Start
  =====================================================
#}

{% macro generate_schema_name(custom_schema_name, node) %}
    {# 
      Override: Verwende nur den custom_schema_name ohne Prefix
      So wird 'mds_master' zu 'mds_master' und nicht 'dv_mds_master'
    #}
    {% if custom_schema_name %}
        {{ custom_schema_name | trim }}
    {% else %}
        {{ target.schema | trim }}
    {% endif %}
{% endmacro %}
