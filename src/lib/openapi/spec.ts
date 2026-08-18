// Hand-maintained OpenAPI 3.0 spec for the public /api/v1 API. Served as
// JSON by src/app/api/v1/openapi.json/route.ts and rendered by the Scalar
// UI at /api-docs. Keep this in sync whenever a v1 route's contract
// changes - this is the only source of truth for what /api-docs shows.
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Master Data Services API',
    version: '1.0.0',
    description:
      'Token-authenticated public REST API for MDS. Covers Model/Entity/Attribute metadata (full CRUD), ' +
      'staged record CRUD with attribute-value filtering, read-only master data and views, and Data Vault ' +
      'import triggering.\n\n' +
      '**Known gap:** committing staged records and deploying them to master/views is session-only today ' +
      '(the internal `/api/commits` and `/api/deploy` UI flows) - there is no v1 endpoint for either step yet, ' +
      'a human has to do that part in the app.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'API token from Settings -> Users -> [user] -> API Tokens (shown once at creation, format `mds_...`). ' +
          'Paste it here to enable "Try it out" on every operation below.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'string' },
        },
        required: ['error'],
      },
      Model: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          code: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
          source_database: { type: 'string', nullable: true },
          target_schema: { type: 'string', nullable: true },
          entity_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          created_by: { type: 'string' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
          updated_by: { type: 'string', nullable: true },
        },
      },
      Entity: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          model_id: { type: 'integer' },
          model_code: { type: 'string' },
          model_name: { type: 'string' },
          code: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
          scd_type: { type: 'string', enum: ['SCD1', 'SCD2'] },
          attribute_count: { type: 'integer' },
          attributes: { type: 'array', items: { $ref: '#/components/schemas/Attribute' } },
        },
      },
      Attribute: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          entity_id: { type: 'integer' },
          entity_code: { type: 'string' },
          entity_name: { type: 'string' },
          code: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          data_type: {
            type: 'string',
            enum: ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'reference'],
          },
          is_required: { type: 'boolean' },
          is_business_key: { type: 'boolean' },
          is_unique: { type: 'boolean' },
          default_value: { type: 'string', nullable: true },
          reference_entity_id: { type: 'integer', nullable: true },
          reference_entity_code: { type: 'string', nullable: true },
          validation_regex: { type: 'string', nullable: true },
          sort_order: { type: 'integer' },
        },
      },
      StagedRecord: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          commit_id: { type: 'integer', nullable: true },
          entity_id: { type: 'integer' },
          entity_code: { type: 'string' },
          entity_name: { type: 'string' },
          operation: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
          business_key: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          previous_data: { type: 'object', additionalProperties: true, nullable: true },
          status: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          created_by: { type: 'string' },
        },
      },
    },
    parameters: {
      AttrFilters: {
        name: 'attr.<code>',
        in: 'query',
        required: false,
        description:
          'Attribute-value filters, one per attribute code. `entity_id` is required whenever any `attr.*` ' +
          'param is used. Operator depends on the attribute\'s data_type:\n\n' +
          '- **string**: `attr.<code>=value` - case-insensitive contains\n' +
          '- **boolean**: `attr.<code>=true|false` - exact match\n' +
          '- **reference**: `attr.<code>=value` - exact match against the referenced business key (not contains)\n' +
          '- **integer / decimal**: `attr.<code>.min=`, `attr.<code>.max=` - inclusive range (either or both)\n' +
          '- **date / datetime**: `attr.<code>.from=`, `attr.<code>.to=` - inclusive range (either or both). ' +
          'datetime values use `yyyy-MM-ddTHH:mm[:ss]`.\n\n' +
          'Unknown attribute codes return 400. Values stored before this filter feature shipped (or entered ' +
          'outside the app\'s own forms) may not be in a canonical format for boolean/date/datetime attributes - ' +
          'such rows are silently excluded from those filters rather than erroring.',
        schema: { type: 'string' },
        style: 'form',
      },
    },
  },
  paths: {
    '/models': {
      get: {
        summary: 'List models',
        tags: ['Models'],
        security: [{ bearerAuth: ['entities:read'] }],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Model' } }, total: { type: 'integer' } } } } },
          },
          401: { description: 'Missing/invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Missing scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        summary: 'Create a model',
        description: 'Requires an admin token (checked live, not just the token scope).',
        tags: ['Models'],
        security: [{ bearerAuth: ['models:write'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'name'],
                properties: {
                  code: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  source_database: { type: 'string' },
                  target_schema: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Code already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/models/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        summary: 'Get a model',
        tags: ['Models'],
        security: [{ bearerAuth: ['entities:read'] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        summary: 'Update a model',
        description: 'Requires an admin token (checked live). Returns the full updated resource.',
        tags: ['Models'],
        security: [{ bearerAuth: ['models:write'] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
                  source_database: { type: 'string' },
                  target_schema: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          400: { description: 'No fields to update', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        summary: 'Delete a model',
        description: 'Requires an admin token (checked live). Blocked while the model still has entities or scoped user-role assignments.',
        tags: ['Models'],
        security: [{ bearerAuth: ['models:write'] }],
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          400: { description: 'Blocked by dependent entities/roles', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/entities': {
      get: {
        summary: 'List entities (with embedded attributes)',
        description: 'Filter with `model_id` or `model_code`.',
        tags: ['Entities'],
        security: [{ bearerAuth: ['entities:read'] }],
        parameters: [
          { name: 'model_id', in: 'query', schema: { type: 'integer' } },
          { name: 'model_code', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Entity' } }, total: { type: 'integer' } } } } } },
        },
      },
      post: {
        summary: 'Create an entity',
        description: 'Requires an admin token (checked live, not just the token scope).',
        tags: ['Entities'],
        security: [{ bearerAuth: ['entities:write'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['model_id', 'code', 'name'],
                properties: {
                  model_id: { type: 'integer' },
                  code: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  scd_type: { type: 'string', enum: ['SCD1', 'SCD2'], default: 'SCD2' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Entity' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Model not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Code already exists in this model', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/entities/{code}': {
      parameters: [
        { name: 'code', in: 'path', required: true, schema: { type: 'string' }, description: 'Entity id (numeric) or code' },
        { name: 'model_code', in: 'query', schema: { type: 'string' }, description: 'Disambiguates a code that exists in more than one model' },
      ],
      get: {
        summary: 'Get an entity (with attributes)',
        tags: ['Entities'],
        security: [{ bearerAuth: ['entities:read'] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Entity' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Ambiguous code across models - add model_code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        summary: 'Update an entity',
        description: 'Requires an admin token (checked live). Returns the full updated resource.',
        tags: ['Entities'],
        security: [{ bearerAuth: ['entities:write'] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  scd_type: { type: 'string', enum: ['SCD1', 'SCD2'] },
                  status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Entity' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Ambiguous code across models - add model_code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        summary: 'Delete an entity',
        description:
          'Requires an admin token (checked live). Blocks only on genuinely outstanding work (attributes still ' +
          'defined, uncommitted staged records, or commits still in flight); terminal history (deployed/rejected ' +
          'commits, already-loaded staged records) is cleaned up automatically. Does not touch physical ' +
          'dbt-generated mds_master/mds_load tables.',
        tags: ['Entities'],
        security: [{ bearerAuth: ['entities:write'] }],
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          400: { description: 'Blocked by outstanding work', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Ambiguous code across models - add model_code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/entities/{code}/import': {
      parameters: [
        { name: 'code', in: 'path', required: true, schema: { type: 'string' }, description: 'Entity id (numeric) or code' },
        { name: 'model_code', in: 'query', schema: { type: 'string' }, description: 'Disambiguates a code that exists in more than one model' },
      ],
      post: {
        summary: 'Trigger a Data Vault import for this entity',
        description:
          'Runs asynchronously via the same job queue as the manual/scheduled import in the UI. The entity ' +
          'must already have an import source configured (Entities -> Import Config). Replaces the entity\'s ' +
          'staged records with a fresh pull from the configured Data Vault source (or a change-tracked merge, ' +
          'if a tracking column is configured on the entity).',
        tags: ['Entities'],
        security: [{ bearerAuth: ['stage:write'] }],
        responses: {
          202: {
            description: 'Import job queued',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, job_id: { type: 'string' }, entity_code: { type: 'string' }, source: { type: 'string' } } } } },
          },
          400: { description: 'No import source configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Ambiguous code across models - add model_code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/attributes': {
      get: {
        summary: "List an entity's attributes",
        description: '`entity_id` is required.',
        tags: ['Attributes'],
        security: [{ bearerAuth: ['entities:read'] }],
        parameters: [{ name: 'entity_id', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Attribute' } }, total: { type: 'integer' } } } } } },
          400: { description: 'entity_id missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        summary: 'Create an attribute',
        description: 'Requires an admin token (checked live, not just the token scope).',
        tags: ['Attributes'],
        security: [{ bearerAuth: ['attributes:write'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['entity_id', 'code', 'name'],
                properties: {
                  entity_id: { type: 'integer' },
                  code: { type: 'string' },
                  name: { type: 'string' },
                  data_type: { type: 'string', enum: ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'reference'] },
                  is_required: { type: 'boolean' },
                  is_business_key: { type: 'boolean' },
                  is_unique: { type: 'boolean' },
                  reference_entity_id: { type: 'integer', description: 'Required when data_type is "reference"' },
                  sort_order: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Attribute' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Entity not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Code already exists on this entity', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/attributes/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        summary: 'Get an attribute',
        tags: ['Attributes'],
        security: [{ bearerAuth: ['entities:read'] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Attribute' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        summary: 'Update an attribute',
        description: 'Requires an admin token (checked live). Returns the full updated resource.',
        tags: ['Attributes'],
        security: [{ bearerAuth: ['attributes:write'] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  data_type: { type: 'string', enum: ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'reference'] },
                  is_required: { type: 'boolean' },
                  is_business_key: { type: 'boolean' },
                  is_unique: { type: 'boolean' },
                  reference_entity_id: { type: 'integer' },
                  sort_order: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Attribute' } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        summary: 'Delete an attribute',
        description: 'Requires an admin token (checked live). No dependency checks - deleting an attribute referenced elsewhere may orphan data.',
        tags: ['Attributes'],
        security: [{ bearerAuth: ['attributes:write'] }],
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, entity_id: { type: 'integer' } } } } } },
          403: { description: 'Missing scope or not admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/stage/records': {
      get: {
        summary: 'List staged records',
        description: 'Filter by `entity_id`, `commit_id`, `status`, and/or attribute-value filters (see `attr.<code>` below). Paginated, `pageSize` capped at 200.',
        tags: ['Staging'],
        security: [{ bearerAuth: ['stage:read'] }],
        parameters: [
          { name: 'entity_id', in: 'query', schema: { type: 'integer' }, description: 'Required when using any attr.* filter' },
          { name: 'commit_id', in: 'query', schema: { type: 'integer' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { $ref: '#/components/parameters/AttrFilters' },
        ],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/StagedRecord' } }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' }, totalPages: { type: 'integer' } } } } },
          },
          400: { description: 'entity_id missing for attr.* filter, or unknown attribute code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        summary: 'Create a staged record',
        tags: ['Staging'],
        security: [{ bearerAuth: ['stage:write'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['entity_id', 'data'],
                properties: {
                  entity_id: { type: 'integer' },
                  operation: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'], default: 'INSERT' },
                  business_key: { type: 'string', description: 'Optional - derived from data using the entity\'s business-key attribute if omitted' },
                  data: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/StagedRecord' } } } },
          400: { description: 'Validation error (missing business_key, invalid reference value, etc.)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Entity not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/stage/records/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        summary: 'Get a staged record',
        tags: ['Staging'],
        security: [{ bearerAuth: ['stage:read'] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/StagedRecord' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      put: {
        summary: 'Update a staged record',
        description:
          'If the record has already been through a commit, it is reset to operation=UPDATE / status=pending ' +
          'and needs a new commit - editing it does not silently change already-committed/deployed data in place.',
        tags: ['Staging'],
        security: [{ bearerAuth: ['stage:write'] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'object', additionalProperties: true }, operation: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] } } },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { record_id: { type: 'string' }, updated_at: { type: 'string' } } } } } },
          400: { description: 'Validation error (e.g. invalid reference value)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        summary: 'Delete a staged record',
        description: 'Never-committed records are hard-deleted. Already-committed records are soft-deleted (flagged operation=DELETE, applied on the next commit/deploy).',
        tags: ['Staging'],
        security: [{ bearerAuth: ['stage:write'] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, action: { type: 'string' } } } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/master': {
      get: {
        summary: 'List entities deployed to mds_master',
        tags: ['Master Data'],
        security: [{ bearerAuth: ['master:read'] }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/master/{entityCode}': {
      parameters: [
        { name: 'entityCode', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'model_code', in: 'query', schema: { type: 'string' }, description: 'Disambiguates a code that exists in more than one model' },
      ],
      get: {
        summary: 'Read deployed master data rows (read-only)',
        tags: ['Master Data'],
        security: [{ bearerAuth: ['master:read'] }],
        parameters: [
          { name: 'business_key', in: 'query', schema: { type: 'string' } },
          { name: 'history', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include historized/deleted rows' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          200: { description: 'OK' },
          404: { description: 'Unknown entity or not yet deployed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Ambiguous code across models - add model_code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: { summary: 'Not allowed - read-only', tags: ['Master Data'], responses: { 405: { description: 'mds_master is read-only via the API' } } },
      put: { summary: 'Not allowed - read-only', tags: ['Master Data'], responses: { 405: { description: 'mds_master is read-only via the API' } } },
      patch: { summary: 'Not allowed - read-only', tags: ['Master Data'], responses: { 405: { description: 'mds_master is read-only via the API' } } },
      delete: { summary: 'Not allowed - read-only', tags: ['Master Data'], responses: { 405: { description: 'mds_master is read-only via the API' } } },
    },
    '/views': {
      get: {
        summary: 'List deployed views',
        tags: ['Views'],
        security: [{ bearerAuth: ['views:read'] }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/views/{code}': {
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Read view rows (read-only)',
        tags: ['Views'],
        security: [{ bearerAuth: ['views:read'] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: { 200: { description: 'OK' }, 404: { description: 'Unknown view', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
      post: { summary: 'Not allowed - read-only', tags: ['Views'], responses: { 405: { description: 'mds_view is read-only via the API' } } },
      put: { summary: 'Not allowed - read-only', tags: ['Views'], responses: { 405: { description: 'mds_view is read-only via the API' } } },
      patch: { summary: 'Not allowed - read-only', tags: ['Views'], responses: { 405: { description: 'mds_view is read-only via the API' } } },
      delete: { summary: 'Not allowed - read-only', tags: ['Views'], responses: { 405: { description: 'mds_view is read-only via the API' } } },
    },
  },
} as const
