{{
  config(
    materialized='view',
    schema='mds_view',
    alias='v_registration_ms64wwk9'
  )
}}

{#
  MDS View: Active Registrations
  Entity: Registration (registration)
  View Type: scd1
  
  Generated: 2026-07-29T18:45:58.912823
  
  Quelle: mds_master.registration (nur aktuelle Records)
#}

SELECT
    name,
    value,
    embedded_url
FROM mds_master.registration
WHERE is_current = 1
  AND is_deleted = 0
