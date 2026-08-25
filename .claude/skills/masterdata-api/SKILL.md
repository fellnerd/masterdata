---
name: masterdata-api
description: Read and write data on a running Master Data Services (MDS) instance via its token-authenticated REST API (/api/v1/*) - discover/create/edit/delete models/entities/attributes, list/create/edit/delete staged records with attribute-value filtering, and read (read-only) deployed master data and views. Use whenever the user wants to interact with data on a masterdata deployment programmatically instead of through the web UI.
---

# masterdata REST API

This skill lets an agent talk to any deployed masterdata instance over HTTP,
independent of this checkout - the instance can be a different server, a
different customer's deployment, anything running this app. Nothing here
assumes local code access; all instructions apply to the API surface only.

An interactive, browsable version of everything below is also always
available at `{baseUrl}/api-docs` (no login required - see "Interactive
docs" further down) - useful for a human to explore or to double check a
request shape live against the real server.

## Before you start

You need two things, provided by the user (never generate or guess these):

1. **Base URL** of the target instance, e.g. `https://masterdata-ppmc.westeurope.cloudapp.azure.com`
2. **API token** (starts with `mds_`), issued by an admin via the running
   instance's UI at `Settings -> Users -> [user] -> API Tokens`. Tokens are
   only ever shown once at creation time - if the user doesn't have one
   handy, tell them to create one there rather than trying to obtain it any
   other way.

If the user pastes a token directly into chat, treat it as exposed once
you're done using it - suggest they revoke and reissue it from the same
Settings page afterward.

Every request needs:
```
Authorization: Bearer mds_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## What this API can and can't do

**Can:** full CRUD on Models, Entities, and Attributes (schema/metadata -
admin token required for writes, see Scopes below); full CRUD on staging
(`mds_stage.staged_record` - data not yet live) including attribute-value
filtering; read-only access to deployed master data and views; triggering
an async Data Vault import for an entity that already has one configured.

**Can't:** commit staged records into a commit, or trigger a deploy that
moves staged data into master. Those actions (`/api/commits`, `/api/deploy`)
require a logged-in browser session, not a Bearer token - they're not part
of this API. After staging changes via this skill, a human with UI access
still has to review, commit, and deploy them. Say this explicitly if the
user expects an end-to-end automated write path - it doesn't exist yet.

Tokens issued before a scope existed won't have it - if you get a 403 with
`"Token is missing required scope: ..."`, tell the user to reissue the
token from Settings (as the right role - see Scopes).

## Scopes

A token carries one or more scopes, assigned automatically from the issuing
user's role at creation time (not something you can request per-call, and
not re-evaluated later - see the admin-check note under Models/Entities/
Attributes below):

| Scope | Who gets it | Grants |
|---|---|---|
| `stage:read` | everyone | `GET` on `/api/v1/stage/records*` |
| `stage:write` | editor, approver, admin (not viewer) | `POST`/`PUT`/`DELETE` on `/api/v1/stage/records*`, `POST .../import` |
| `master:read` | everyone | `GET` on `/api/v1/master*` |
| `views:read` | everyone | `GET` on `/api/v1/views*` |
| `entities:read` | everyone | `GET` on `/api/v1/models*`, `/api/v1/entities*`, `/api/v1/attributes*` (read covers all three metadata resources under one scope) |
| `models:write` | **admin only** | `POST`/`PUT`/`DELETE` on `/api/v1/models*` |
| `entities:write` | **admin only** | `POST`/`PUT`/`DELETE` on `/api/v1/entities*` |
| `attributes:write` | **admin only** | `POST`/`PUT`/`DELETE` on `/api/v1/attributes*` |

The three `*:write` scopes are stricter than `stage:write`: schema-level
changes (Model/Entity/Attribute) are admin-only, not editor/approver. Even
with the scope present, every write on these three resources **also**
re-checks the token owner's *current* role live against the database (not
just the scope baked into the token at issuance) - so a token issued while
its owner was admin stops working for these calls the moment that user is
demoted, without needing to reissue or revoke anything.

A 403 with `"Token is missing required scope: ..."` means the scope isn't
on the token at all (issuing user's role at creation time). A 403 with
`"...admin role (checked live...)"` means the scope is present but the
issuing user isn't currently admin - a different (currently-admin) user
needs to issue a fresh token.

## Endpoints

All list endpoints are paginated: `?page=1&pageSize=50` (`pageSize` capped
at 200 server-side on `stage/records`, `master/{code}`, `views/{code}`),
response includes `{ data, total, page, pageSize, totalPages }`. `models`
and `entities` lists are unpaginated (`{ data, total }`). Both `page` and
`pageSize` must be positive integers - `0`, negative, or non-numeric values
return a clean `400` rather than a database error.

### Models

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/models` | List all models, with `entity_count` per model |
| POST | `/api/v1/models` | Body: `{ code, name, description?, source_database?, target_schema? }`. Admin token required. |
| GET | `/api/v1/models/{id}` | Single model by numeric id |
| PUT | `/api/v1/models/{id}` | Partial update, same fields as POST plus `status`. Admin token required. Returns the full updated model. |
| DELETE | `/api/v1/models/{id}` | Admin token required. Blocked (`400`) while the model still has entities or scoped user-role assignments. |

### Entities

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/entities` | Filter with `?model_id=` or `?model_code=`. Each entity includes an embedded `attributes` array (`code`, `name`, `data_type`, `max_length`, `is_required`, `is_business_key`) - this is how you find what to put in `data` when staging a record. |
| POST | `/api/v1/entities` | Body: `{ model_id, code, name, description?, scd_type? }` (`scd_type`: `SCD1`/`SCD2`, default `SCD2`). Admin token required. |
| GET | `/api/v1/entities/{code}` | `{code}` accepts either the numeric entity id or its code. **`entity.code` is only unique per-model, not globally** - if the same code exists in more than one model, this returns `409`; add `?model_code=` to disambiguate. |
| PUT | `/api/v1/entities/{code}` | Body: `{ name?, description?, scd_type?, status? }`. Admin token required. Same `?model_code=` disambiguation as GET. Returns the full updated entity. |
| DELETE | `/api/v1/entities/{code}` | Admin token required. Same `?model_code=` disambiguation. Blocks (`400`) only on genuinely outstanding work - attributes still defined on it, uncommitted staged records, or commits still in flight (draft/pending/approved). Terminal history (deployed/rejected commits, already-loaded staged records) is cleaned up automatically as part of the delete. **Does not** touch the physical dbt-generated `mds_master`/`mds_load` tables for the entity - those may still hold historized data after this call. |

### Attributes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/attributes?entity_id=` | `entity_id` is **required**. Lists that entity's attributes standalone (same data also embedded in `GET /api/v1/entities`). |
| POST | `/api/v1/attributes` | Body: `{ entity_id, code, name, data_type?, is_required?, is_business_key?, is_unique?, reference_entity_id?, sort_order? }`. `data_type` one of `string`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `reference`; `reference_entity_id` required when `data_type` is `reference`. Admin token required. |
| GET | `/api/v1/attributes/{id}` | Single attribute by numeric id |
| PUT | `/api/v1/attributes/{id}` | Partial update, same fields as POST. Admin token required. Returns the full updated attribute. |
| DELETE | `/api/v1/attributes/{id}` | Admin token required. No dependency checks - deleting an attribute referenced elsewhere (e.g. by staged data) can orphan data, unlike Entity delete. |

### Staging (full CRUD + attribute-value filtering)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/stage/records` | Filter with `?entity_id=&commit_id=&status=` plus optional `attr.*` filters (see below) |
| POST | `/api/v1/stage/records` | Body: `{ entity_id, operation?, business_key?, data }` - see below |
| GET | `/api/v1/stage/records/{id}` | Single record |
| PUT | `/api/v1/stage/records/{id}` | Body: `{ data?, operation? }` - partial update. If the record has already been through a commit, this resets it to `operation=UPDATE`/`status=pending` rather than silently changing already-committed data - it needs a new commit afterward. |
| DELETE | `/api/v1/stage/records/{id}` | Never-committed records are hard-deleted outright; already-committed records are soft-deleted (flagged `operation=DELETE`, applied on the next commit/deploy). |

POST/PUT body `data` fields are validated per attribute: a `reference`-typed
attribute's value must exactly match an existing `business_key` in the
referenced entity's staged records, or the request is rejected with `400`.

POST body fields:
- `entity_id` (required, number) - which entity this record belongs to
- `operation` - `"INSERT"` (default), `"UPDATE"`, or `"DELETE"`
- `business_key` - optional if the entity has a designated business-key
  attribute; the server derives it from `data` in that case. Required if not.
- `data` (required, object) - the record's field values, keyed by attribute code

#### Attribute-value filters (`attr.*`)

Add to any `GET /api/v1/stage/records` call. `entity_id` **must** also be
present whenever any `attr.*` param is used (attribute codes are
entity-scoped) - omitting it returns `400`. An unknown attribute code for
the entity also returns `400`.

| data_type | Param(s) | Semantics |
|---|---|---|
| string | `attr.<code>=value` | case-insensitive **contains** |
| string | `attr.<code>.exact=value` | opt-in exact match instead of contains (e.g. dropdown-style filters) |
| boolean | `attr.<code>=true\|false` | exact match |
| reference | `attr.<code>=value` | exact match against the referenced business key (**not** contains) |
| integer / decimal | `attr.<code>.min=`, `attr.<code>.max=` | inclusive range, either or both |
| date | `attr.<code>.from=`, `attr.<code>.to=` | inclusive range, `yyyy-MM-dd` |
| datetime | `attr.<code>.from=`, `attr.<code>.to=` | inclusive range, `yyyy-MM-ddTHH:mm[:ss]` |

Example: `GET /api/v1/stage/records?entity_id=7&attr.amount.min=100&attr.active=true`
Example: `GET /api/v1/stage/records?entity_id=7&attr.status_code.exact=OK` (won't also match `NOK`)

**Known limitation:** a staged value that predates this filter feature (or
was written by something other than the app's own record forms) may not be
in a canonical format for `boolean`/`date`/`datetime` attributes - such rows
are silently excluded from those filters rather than erroring. `string` and
`reference` filters are unaffected (plain text comparison).

### Import (async, scope: stage:write)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/entities/{code}/import` | Triggers a Data Vault import for this entity. `{code}` accepts numeric id or code, same `?model_code=` disambiguation as the Entities endpoints. Entity must already have an import source configured in the UI (Entities → Import Config) - this endpoint can't set one. Returns `202` with `{ job_id, entity_code, source }` immediately; the import runs asynchronously (replaces the entity's staged records with a fresh pull, or a change-tracked merge if a tracking column is configured) and doesn't wait for completion. Poll `GET /api/v1/stage/records?entity_id=` afterward to see the result, or tell the user to check the Jobs page for progress/errors. |

`404` if the entity code doesn't exist, `400` if it exists but has no
import source configured yet, `409` if the code is ambiguous across models.

### Master data (read-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/master` | Lists entity codes that have a deployed `mds_master` table |
| GET | `/api/v1/master/{entityCode}` | `?business_key=&history=true&page=&pageSize=&model_code=`. Without `history=true`, only current non-deleted rows. Same code-ambiguity `409`/`?model_code=` behavior as Entities. `POST`/`PUT`/`PATCH`/`DELETE` all return `405`. |

### Views (read-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/views` | Lists deployed, active views |
| GET | `/api/v1/views/{code}` | `?page=&pageSize=`. Write methods return `405`. |

## Interactive docs

`{baseUrl}/api-docs` serves a full interactive OpenAPI reference (Scalar UI)
for everything above - reachable without any session login (it authenticates
"Try it out" calls via a pasted API token inside the page itself, not via
the app's normal MSAL/session login). The raw spec is also available
directly at `{baseUrl}/api/v1/openapi.json`. Point a user here if they want
to explore or test the API themselves rather than through you.

## Example workflow

```bash
BASE="https://your-instance.example.com"
TOKEN="mds_..."

# 1. Find the entity you want to stage a record for, and its attribute codes
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/entities?model_code=CUSTOMER" | jq

# 2. See what master data already exists
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/master" | jq
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/master/customer?pageSize=20" | jq

# 3. Stage a new record (needs stage:write; entity_id and attribute codes from step 1)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": 4, "data": {"code": "ACME", "name": "Acme Corp"}}' \
  "$BASE/api/v1/stage/records" | jq

# 4. Edit that staged record before it's committed
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"data": {"code": "ACME", "name": "Acme Corporation"}}' \
  "$BASE/api/v1/stage/records/123" | jq

# 5. Find staged records for entity 4 with amount over 1000, still pending
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/stage/records?entity_id=4&status=pending&attr.amount.min=1000" | jq

# -> tell the user a human still needs to commit + deploy this in the UI

# --- Admin-only: schema management ---

# 6. Create a new entity in an existing model (requires an admin token)
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"model_id": 4, "code": "supplier", "name": "Supplier", "scd_type": "SCD1"}' \
  "$BASE/api/v1/entities" | jq

# 7. Add an attribute to it
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": 42, "code": "name", "name": "Name", "data_type": "string", "is_business_key": true, "is_required": true}' \
  "$BASE/api/v1/attributes" | jq
```

## Errors

Every error response is `{ "error": "..." }` (sometimes with a `details`
field) with a matching HTTP status:

| Status | Meaning |
|---|---|
| 400 | Bad request (missing required field, invalid reference value, unknown attribute code in a filter, `attr.*` filter used without `entity_id`, invalid entity code format) |
| 401 | Missing/empty/invalid/expired/revoked token |
| 403 | Token valid but missing the required scope, or (Models/Entities/Attributes writes) the token owner isn't currently admin |
| 404 | Record/entity/model/attribute/view not found, or entity not yet deployed to master |
| 405 | Write attempted on a read-only endpoint (master, views) |
| 409 | Duplicate code (Model/Entity/Attribute create), or an entity code that's ambiguous across models (add `?model_code=`) |
| 500 | Server error - check `details` in the response body |
