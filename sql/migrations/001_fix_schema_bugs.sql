-- ============================================================================
-- Migration: Fix Schema Bugs (001)
-- ============================================================================
-- Purpose: Fix missing columns found during MDS testing
-- Date: 2025-01-XX
-- ============================================================================

PRINT '=== Starting Schema Bug Fixes Migration ===';

-- ----------------------------------------------------------------------------
-- 1. mds_meta.entity - Add missing columns
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity') AND name = 'status')
BEGIN
    ALTER TABLE [mds_meta].[entity] ADD [status] NVARCHAR(20) NOT NULL DEFAULT 'draft';
    PRINT 'Added column: entity.status';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity') AND name = 'is_versioned')
BEGIN
    ALTER TABLE [mds_meta].[entity] ADD [is_versioned] BIT NOT NULL DEFAULT 1;
    PRINT 'Added column: entity.is_versioned';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity') AND name = 'primary_key_attribute')
BEGIN
    ALTER TABLE [mds_meta].[entity] ADD [primary_key_attribute] NVARCHAR(100) NULL;
    PRINT 'Added column: entity.primary_key_attribute';
END

-- ----------------------------------------------------------------------------
-- 2. mds_meta.attribute - Add missing columns
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'description')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [description] NVARCHAR(MAX) NULL;
    PRINT 'Added column: attribute.description';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'sql_type')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [sql_type] NVARCHAR(100) NULL;
    PRINT 'Added column: attribute.sql_type';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'precision')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [precision] INT NULL;
    PRINT 'Added column: attribute.precision';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'scale')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [scale] INT NULL;
    PRINT 'Added column: attribute.scale';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'is_required')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [is_required] BIT NOT NULL DEFAULT 0;
    PRINT 'Added column: attribute.is_required';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'is_unique')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [is_unique] BIT NOT NULL DEFAULT 0;
    PRINT 'Added column: attribute.is_unique';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.attribute') AND name = 'reference_entity_id')
BEGIN
    ALTER TABLE [mds_meta].[attribute] ADD [reference_entity_id] INT NULL;
    PRINT 'Added column: attribute.reference_entity_id';
END

-- ----------------------------------------------------------------------------
-- 3. mds_stage.commit - Add missing columns
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.commit') AND name = 'entity_id')
BEGIN
    -- entity_id is required, so we need special handling for existing rows
    ALTER TABLE [mds_stage].[commit] ADD [entity_id] INT NULL;
    PRINT 'Added column: commit.entity_id (nullable for migration)';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.commit') AND name = 'record_count')
BEGIN
    ALTER TABLE [mds_stage].[commit] ADD [record_count] INT NOT NULL DEFAULT 0;
    PRINT 'Added column: commit.record_count';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.commit') AND name = 'rejected_at')
BEGIN
    ALTER TABLE [mds_stage].[commit] ADD [rejected_at] DATETIME2 NULL;
    PRINT 'Added column: commit.rejected_at';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.commit') AND name = 'rejected_by')
BEGIN
    ALTER TABLE [mds_stage].[commit] ADD [rejected_by] NVARCHAR(100) NULL;
    PRINT 'Added column: commit.rejected_by';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.commit') AND name = 'rejection_reason')
BEGIN
    ALTER TABLE [mds_stage].[commit] ADD [rejection_reason] NVARCHAR(500) NULL;
    PRINT 'Added column: commit.rejection_reason';
END

-- ----------------------------------------------------------------------------
-- 4. mds_meta.entity_view - Create if not exists or add missing columns
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'entity_view' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[entity_view] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [code] NVARCHAR(100) NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX) NULL,
        [view_type] NVARCHAR(50) NOT NULL DEFAULT 'scd1',
        [custom_sql] NVARCHAR(MAX) NULL,
        [column_config] NVARCHAR(MAX) NULL,
        [filter_condition] NVARCHAR(MAX) NULL,
        [filter_expression] NVARCHAR(MAX) NULL,
        [is_default] BIT NOT NULL DEFAULT 0,
        [is_deployed] BIT NOT NULL DEFAULT 0,
        [is_active] BIT NOT NULL DEFAULT 1,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'draft',
        [last_deployed_at] DATETIME2 NULL,
        [deployed_at] DATETIME2 NULL,
        [deployed_by] NVARCHAR(100) NULL,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL DEFAULT 'system',
        [updated_at] DATETIME2 NULL,
        [updated_by] NVARCHAR(100) NULL,
        CONSTRAINT [UQ_entity_view_entity_code] UNIQUE ([entity_id], [code]),
        CONSTRAINT [CK_entity_view_type] CHECK ([view_type] IN ('scd1', 'scd2', 'custom'))
    );
    PRINT 'Created table: mds_meta.entity_view';
END
ELSE
BEGIN
    -- Add missing columns to existing entity_view table
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'view_type')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [view_type] NVARCHAR(50) NOT NULL DEFAULT 'scd1';
        PRINT 'Added column: entity_view.view_type';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'custom_sql')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [custom_sql] NVARCHAR(MAX) NULL;
        PRINT 'Added column: entity_view.custom_sql';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'column_config')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [column_config] NVARCHAR(MAX) NULL;
        PRINT 'Added column: entity_view.column_config';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'filter_condition')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [filter_condition] NVARCHAR(MAX) NULL;
        PRINT 'Added column: entity_view.filter_condition';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'filter_expression')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [filter_expression] NVARCHAR(MAX) NULL;
        PRINT 'Added column: entity_view.filter_expression';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'is_deployed')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [is_deployed] BIT NOT NULL DEFAULT 0;
        PRINT 'Added column: entity_view.is_deployed';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'is_active')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [is_active] BIT NOT NULL DEFAULT 1;
        PRINT 'Added column: entity_view.is_active';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'last_deployed_at')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [last_deployed_at] DATETIME2 NULL;
        PRINT 'Added column: entity_view.last_deployed_at';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity_view') AND name = 'status')
    BEGIN
        ALTER TABLE [mds_meta].[entity_view] ADD [status] NVARCHAR(20) NOT NULL DEFAULT 'draft';
        PRINT 'Added column: entity_view.status';
    END
END

-- ----------------------------------------------------------------------------
-- 5. mds_load.deployment_log - Create if not exists
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'deployment_log' AND schema_id = SCHEMA_ID('mds_load'))
BEGIN
    CREATE TABLE [mds_load].[deployment_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [commit_id] INT NULL REFERENCES [mds_stage].[commit]([id]),
        [deployment_type] NVARCHAR(50) NOT NULL,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'pending',
        [records_processed] INT NOT NULL DEFAULT 0,
        [records_inserted] INT NOT NULL DEFAULT 0,
        [records_updated] INT NOT NULL DEFAULT 0,
        [error_message] NVARCHAR(MAX) NULL,
        [started_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [completed_at] DATETIME2 NULL,
        [deployed_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [CK_deployment_log_status] CHECK ([status] IN ('pending', 'running', 'completed', 'failed'))
    );
    PRINT 'Created table: mds_load.deployment_log';
END

PRINT '=== Schema Bug Fixes Migration Complete ===';
