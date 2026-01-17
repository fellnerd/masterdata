-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 4: Load Tables (mds_load schema)
-- ============================================================================
-- Purpose: Approved master data storage
-- Target: Azure SQL Database
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Master Record: Approved and deployed master data
-- Uses JSON for flexible schema to support any entity type
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'master_record' AND schema_id = SCHEMA_ID('mds_load'))
BEGIN
    CREATE TABLE [mds_load].[master_record] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [business_key] NVARCHAR(500) NOT NULL,
        [business_key_hash] CHAR(64) NOT NULL,           -- SHA2_256 hash
        [data] NVARCHAR(MAX) NOT NULL,                   -- JSON object with all attributes
        [version] INT NOT NULL DEFAULT 1,
        [is_current] BIT NOT NULL DEFAULT 1,
        [valid_from] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [valid_to] DATETIME2 NULL,                       -- NULL = current version
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [updated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [updated_by] NVARCHAR(100) NOT NULL,
        [commit_id] INT NULL REFERENCES [mds_stage].[commit]([id]),
        
        -- Unique constraint for current version per business key per entity
        CONSTRAINT [UQ_master_record_current] UNIQUE ([entity_id], [business_key_hash], [is_current]) 
    );
    
    -- Index for fast lookup by entity and business key
    CREATE NONCLUSTERED INDEX [IX_master_record_entity_bk]
        ON [mds_load].[master_record]([entity_id], [business_key_hash], [is_current])
        INCLUDE ([business_key], [data], [version]);
    
    -- Index for current records
    CREATE NONCLUSTERED INDEX [IX_master_record_current]
        ON [mds_load].[master_record]([entity_id], [is_current])
        WHERE [is_current] = 1;
        
    PRINT 'Created table: mds_load.master_record';
END
GO

-- ----------------------------------------------------------------------------
-- Deployment Log: Tracks deployments to Data Vault
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'deployment_log' AND schema_id = SCHEMA_ID('mds_load'))
BEGIN
    CREATE TABLE [mds_load].[deployment_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [commit_ids] NVARCHAR(MAX) NOT NULL,             -- JSON array of commit IDs
        [status] NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
        [records_deployed] INT NULL,
        [started_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [completed_at] DATETIME2 NULL,
        [deployed_by] NVARCHAR(100) NOT NULL,
        [dbt_run_id] NVARCHAR(100) NULL,
        [error_message] NVARCHAR(MAX) NULL,
        CONSTRAINT [CK_deployment_log_status] CHECK ([status] IN ('pending', 'running', 'completed', 'failed'))
    );
    PRINT 'Created table: mds_load.deployment_log';
END
GO

PRINT '=== Load tables creation complete ===';
