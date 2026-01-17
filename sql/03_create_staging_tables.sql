-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 3: Staging and Commit Tables (mds_stage schema)
-- ============================================================================
-- Purpose: Tables for staging data and managing commits
-- Target: Azure SQL Database
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Commit: Groups changes together for approval workflow
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'commit' AND schema_id = SCHEMA_ID('mds_stage'))
BEGIN
    CREATE TABLE [mds_stage].[commit] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [code] NVARCHAR(50) NOT NULL UNIQUE,             -- e.g., CMT-2024-0001
        [description] NVARCHAR(MAX) NULL,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, deployed
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [record_count] INT NOT NULL DEFAULT 0,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        [approved_at] DATETIME2 NULL,
        [approved_by] NVARCHAR(100) NULL,
        [rejected_at] DATETIME2 NULL,
        [rejected_by] NVARCHAR(100) NULL,
        [rejection_reason] NVARCHAR(500) NULL,
        [deployed_at] DATETIME2 NULL,
        [deployed_by] NVARCHAR(100) NULL,
        CONSTRAINT [CK_commit_status] CHECK ([status] IN ('pending', 'approved', 'rejected', 'deployed'))
    );
    PRINT 'Created table: mds_stage.commit';
END
GO

-- ----------------------------------------------------------------------------
-- Staged Record: Individual data records awaiting approval
-- This is a generic table using JSON for flexible schema
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'staged_record' AND schema_id = SCHEMA_ID('mds_stage'))
BEGIN
    CREATE TABLE [mds_stage].[staged_record] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [commit_id] INT NOT NULL REFERENCES [mds_stage].[commit]([id]),
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [operation] NVARCHAR(10) NOT NULL,               -- INSERT, UPDATE, DELETE
        [business_key] NVARCHAR(500) NOT NULL,           -- Concatenated business key values
        [business_key_hash] CHAR(64) NOT NULL,           -- SHA2_256 hash of business key
        [data] NVARCHAR(MAX) NOT NULL,                   -- JSON object with all attributes
        [previous_data] NVARCHAR(MAX) NULL,              -- Previous JSON for UPDATE/DELETE
        [validation_status] NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, valid, invalid
        [validation_errors] NVARCHAR(MAX) NULL,          -- JSON array of validation errors
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [created_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [CK_staged_record_operation] CHECK ([operation] IN ('INSERT', 'UPDATE', 'DELETE')),
        CONSTRAINT [CK_staged_record_validation] CHECK ([validation_status] IN ('pending', 'valid', 'invalid'))
    );
    
    -- Index for fast lookup by commit
    CREATE NONCLUSTERED INDEX [IX_staged_record_commit] 
        ON [mds_stage].[staged_record]([commit_id]) INCLUDE ([entity_id], [operation]);
    
    -- Index for duplicate detection
    CREATE NONCLUSTERED INDEX [IX_staged_record_entity_bk_hash]
        ON [mds_stage].[staged_record]([entity_id], [business_key_hash]);
        
    PRINT 'Created table: mds_stage.staged_record';
END
GO

-- ----------------------------------------------------------------------------
-- Validation Result: Stores validation results for staged records
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'validation_result' AND schema_id = SCHEMA_ID('mds_stage'))
BEGIN
    CREATE TABLE [mds_stage].[validation_result] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [staged_record_id] BIGINT NOT NULL REFERENCES [mds_stage].[staged_record]([id]),
        [validation_rule_id] INT NOT NULL REFERENCES [mds_meta].[validation_rule]([id]),
        [is_valid] BIT NOT NULL,
        [error_message] NVARCHAR(500) NULL,
        [validated_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE NONCLUSTERED INDEX [IX_validation_result_staged_record]
        ON [mds_stage].[validation_result]([staged_record_id]);
        
    PRINT 'Created table: mds_stage.validation_result';
END
GO

PRINT '=== Staging tables creation complete ===';
