---
name: masterdata-api
description: Read and write data on a running Master Data Services (MDS) instance via its token-authenticated REST API (/api/v1/*) - list/create/edit/delete staged records, and read (read-only) deployed master data and views. Use whenever the user wants to interact with data on a masterdata deployment programmatically instead of through the web UI.
---

# masterdata REST API

This skill lets an agent talk to any deployed masterdata instance over HTTP,
independent of this checkout - the instance can be a different server, a
different customer's deployment, anything running this app. Nothing here
assumes local code access; all instructions apply to the API surface only.

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

**Can:** full CRUD on staging (`mds_stage.staged_record` - data not yet
live), read-only access to deployed master data and views.

**Can't:** commit staged records into a commit, or trigger a deploy that
moves staged data into master. Those actions (`/api/commits`, `/api/deploy`)
require a logged-in browser session, not a Bearer token - they're not part
of this API. After staging changes via this skill, a human with UI access
still has to review, commit, and deploy them. Say this explicitly if the
user expects an end-to-end automated write path - it doesn't exist yet.

**Can't:** discover entities/attributes/models by API (`/api/entities` etc.
are internal, session-only routes, not part of `/api/v1`). To stage a
record you need to already know the numeric `entity_id` and its attribute
codes - ask the user, or have them look it up in the UI under Models/Entities.

## Scopes

A token carries one or more scopes, assigned automatically from the issuing
user's role at creation time (not something you can request per-call):

| Scope | Who gets it | Grants |
|---|---|---|
| `stage:read` | everyone | `GET` on `/api/v1/stage/records*` |
| `stage:write` | editor, approver, admin (not viewer) | `POST`/`PUT`/`DELETE` on `/api/v1/stage/records*` |
| `master:read` | everyone | `GET` on `/api/v1/master*` |
| `views:read` | everyone | `GET` on `/api/v1/views*` |

A 403 with `"Token is missing required scope: ..."` means the issuing
user's role doesn't allow that action - a different user needs to issue the
token, not something fixable client-side.

## Endpoints

All list endpoints are paginated: `?page=1&pageSize=50` (`pageSize` capped
at 200 server-side), response includes `{ data, total, page, pageSize,
totalPages }`.

### Staging (full CRUD)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/stage/records` | Filter with `?entity_id=&commit_id=&status=` |
| POST | `/api/v1/stage/records` | Body: `{ entity_id, operation?, business_key?, data }` - see below |
| GET | `/api/v1/stage/records/{id}` | Single record |
| PUT | `/api/v1/stage/records/{id}` | Body: `{ data?, operation? }` - partial update |
| DELETE | `/api/v1/stage/records/{id}` | Deletes a still-pending record outright; on an already-loaded record, instead flags a DELETE operation for the next deploy |

POST body fields:
- `entity_id` (required, number) - which entity this record belongs to
- `operation` - `"INSERT"` (default), `"UPDATE"`, or `"DELETE"`
- `business_key` - optional if the entity has a designated business-key
  attribute; the server derives it from `data` in that case. Required if not.
- `data` (required, object) - the record's field values, keyed by attribute code

### Master data (read-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/master` | Lists entity codes that have a deployed `mds_master` table |
| GET | `/api/v1/master/{entityCode}` | `?business_key=&history=true&page=&pageSize=`. Without `history=true`, only current non-deleted rows. `POST`/`PUT`/`PATCH`/`DELETE` all return `405`. |

### Views (read-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/views` | Lists deployed, active views |
| GET | `/api/v1/views/{code}` | `?page=&pageSize=`. Write methods return `405`. |

## Example workflow

```bash
BASE="https://your-instance.example.com"
TOKEN="mds_..."

# 1. See what master data exists
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/master" | jq

# 2. Read current master data for one entity
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/master/customer?pageSize=20" | jq

# 3. Stage a new record (needs stage:write)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": 4, "data": {"code": "ACME", "name": "Acme Corp"}}' \
  "$BASE/api/v1/stage/records" | jq

# 4. Edit that staged record before it's committed
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"data": {"code": "ACME", "name": "Acme Corporation"}}' \
  "$BASE/api/v1/stage/records/123" | jq

# -> tell the user a human still needs to commit + deploy this in the UI
```

## Errors

Every error response is `{ "error": "..." }` with a matching HTTP status:

| Status | Meaning |
|---|---|
| 400 | Bad request (missing required field, invalid entity code format) |
| 401 | Missing/empty/invalid/expired/revoked token |
| 403 | Token valid but missing the required scope |
| 404 | Record/entity/view not found, or entity not yet deployed to master |
| 405 | Write attempted on a read-only endpoint (master, views) |
| 500 | Server error - check `details` in the response body |
