-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 2: Metadata Tables (mds_meta schema)
-- ============================================================================
-- Purpose: Core metadata tables for model configuration
-- Target: Azure SQL Database
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Model: Represents a logical grouping of entities (e.g., CRM, Product Catalog)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'model' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[model] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [code] NVARCHAR(50) NOT NULL UNIQUE,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [version] INT NOT NULL DEFAULT 1,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft, active, deprecated
        [source_database] NVARCHAR(255) NULL,            -- PostgreSQL source DB name
        [target_schema] NVARCHAR(50) NULL,               -- Target schema in Data Vault
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [CK_model_status] CHECK ([status] IN ('draft', 'active', 'deprecated'))
    );
    PRINT 'Created table: mds_meta.model';
END
GO

-- ----------------------------------------------------------------------------
-- Entity: Represents a master data entity within a model (e.g., Customer, Product)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'entity' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[entity] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [model_id] INT NOT NULL REFERENCES [mds_meta].[model]([id]),
        [code] NVARCHAR(50) NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [source_table] NVARCHAR(255) NULL,               -- Source table in PostgreSQL
        [staging_view] NVARCHAR(255) NULL,               -- dbt staging view name
        [hub_name] NVARCHAR(255) NULL,                   -- Data Vault hub name
        [is_deployed] BIT NOT NULL DEFAULT 0,
        [last_deployed_at] DATETIME2 NULL,
        [record_count] INT NULL,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft, active, deprecated
        [is_versioned] BIT NOT NULL DEFAULT 1,           -- Enable SCD2 versioning
        [primary_key_attribute] NVARCHAR(100) NULL,      -- Business key attribute code
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [UQ_entity_model_code] UNIQUE ([model_id], [code])
    );
    PRINT 'Created table: mds_meta.entity';
END
GO

-- ----------------------------------------------------------------------------
-- Attribute: Defines the columns/fields of an entity
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'attribute' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[attribute] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [code] NVARCHAR(50) NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [data_type] NVARCHAR(50) NOT NULL,               -- string, integer, decimal, date, datetime, boolean
        [sql_type] NVARCHAR(100) NULL,                   -- Actual SQL type (NVARCHAR(255), INT, etc.)
        [is_business_key] BIT NOT NULL DEFAULT 0,
        [is_required] BIT NOT NULL DEFAULT 0,
        [is_unique] BIT NOT NULL DEFAULT 0,
        [max_length] INT NULL,
        [precision] INT NULL,
        [scale] INT NULL,
        [default_value] NVARCHAR(255) NULL,
        [validation_regex] NVARCHAR(500) NULL,
        [reference_entity_id] INT NULL REFERENCES [mds_meta].[entity]([id]),  -- FK reference
        [sort_order] INT NOT NULL DEFAULT 0,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [UQ_attribute_entity_code] UNIQUE ([entity_id], [code]),
        CONSTRAINT [CK_attribute_data_type] CHECK ([data_type] IN ('string', 'integer', 'decimal', 'date', 'datetime', 'boolean', 'reference'))
    );
    PRINT 'Created table: mds_meta.attribute';
END
GO

-- ----------------------------------------------------------------------------
-- Validation Rule: Custom validation rules for entities
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'validation_rule' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[validation_rule] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [code] NVARCHAR(50) NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [rule_type] NVARCHAR(50) NOT NULL,               -- required, unique, regex, range, custom_sql, reference
        [severity] NVARCHAR(20) NOT NULL DEFAULT 'error', -- error, warning, info
        [expression] NVARCHAR(MAX) NOT NULL,             -- SQL expression or regex pattern
        [error_message] NVARCHAR(500) NULL,
        [is_active] BIT NOT NULL DEFAULT 1,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [UQ_validation_rule_entity_code] UNIQUE ([entity_id], [code]),
        CONSTRAINT [CK_validation_rule_type] CHECK ([rule_type] IN ('required', 'unique', 'regex', 'range', 'custom_sql', 'reference')),
        CONSTRAINT [CK_validation_rule_severity] CHECK ([severity] IN ('error', 'warning', 'info'))
    );
    PRINT 'Created table: mds_meta.validation_rule';
END
GO

-- ----------------------------------------------------------------------------
-- User Role: Maps users to roles for RBAC
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_role' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[user_role] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] NVARCHAR(255) NOT NULL,                -- Microsoft Entra ID object ID
        [email] NVARCHAR(255) NOT NULL,
        [display_name] NVARCHAR(255) NULL,
        [role] NVARCHAR(20) NOT NULL,                    -- viewer, editor, approver, admin
        [model_id] INT NULL REFERENCES [mds_meta].[model]([id]), -- NULL = all models
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [UQ_user_role] UNIQUE ([user_id], [role], [model_id]),
        CONSTRAINT [CK_user_role_role] CHECK ([role] IN ('viewer', 'editor', 'approver', 'admin'))
    );
    PRINT 'Created table: mds_meta.user_role';
END
GO

-- ----------------------------------------------------------------------------
-- Entity View: View definitions for entities
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'entity_view' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[entity_view] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [code] NVARCHAR(100) NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [view_type] NVARCHAR(50) NOT NULL DEFAULT 'scd1',  -- scd1, scd2, custom
        [custom_sql] NVARCHAR(MAX) NULL,                   -- SQL query für custom views
        [column_config] NVARCHAR(MAX) NULL,                -- JSON config für Spalten
        [filter_condition] NVARCHAR(MAX) NULL,             -- WHERE clause filter
        [filter_expression] NVARCHAR(MAX) NULL,            -- Additional filter expression
        [is_default] BIT NOT NULL DEFAULT 0,
        [is_deployed] BIT NOT NULL DEFAULT 0,
        [is_active] BIT NOT NULL DEFAULT 1,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'draft',    -- draft, active, deprecated
        [last_deployed_at] DATETIME2 NULL,
        [deployed_at] DATETIME2 NULL,
        [deployed_by] NVARCHAR(100) NULL,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NULL,
        [updated_by] NVARCHAR(100) NULL,
        CONSTRAINT [UQ_entity_view_entity_code] UNIQUE ([entity_id], [code]),
        CONSTRAINT [CK_entity_view_type] CHECK ([view_type] IN ('scd1', 'scd2', 'custom'))
    );
    PRINT 'Created table: mds_meta.entity_view';
END
GO

-- ----------------------------------------------------------------------------
-- Configuration: System-wide settings
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'configuration' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[configuration] (
        [key] NVARCHAR(100) PRIMARY KEY,
        [value] NVARCHAR(MAX) NOT NULL,
        [description] NVARCHAR(500) NULL,
        [data_type] NVARCHAR(20) NOT NULL DEFAULT 'string', -- string, integer, boolean, json
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL
    );
    PRINT 'Created table: mds_meta.configuration';
END
GO

PRINT '=== Metadata tables creation complete ===';
