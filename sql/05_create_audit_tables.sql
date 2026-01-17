-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 5: Audit Tables (mds_audit schema)
-- ============================================================================
-- Purpose: Change tracking and audit logging
-- Target: Azure SQL Database
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Change Log: Tracks all changes to master data
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'change_log' AND schema_id = SCHEMA_ID('mds_audit'))
BEGIN
    CREATE TABLE [mds_audit].[change_log] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [entity_id] INT NOT NULL REFERENCES [mds_meta].[entity]([id]),
        [entity_code] NVARCHAR(50) NOT NULL,
        [business_key] NVARCHAR(500) NOT NULL,
        [operation] NVARCHAR(10) NOT NULL,               -- INSERT, UPDATE, DELETE
        [old_data] NVARCHAR(MAX) NULL,                   -- JSON before change
        [new_data] NVARCHAR(MAX) NULL,                   -- JSON after change
        [changed_fields] NVARCHAR(MAX) NULL,             -- JSON array of changed field names
        [commit_id] INT NULL REFERENCES [mds_stage].[commit]([id]),
        [changed_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [changed_by] NVARCHAR(100) NOT NULL,
        CONSTRAINT [CK_change_log_operation] CHECK ([operation] IN ('INSERT', 'UPDATE', 'DELETE'))
    );
    
    -- Index for querying by entity
    CREATE NONCLUSTERED INDEX [IX_change_log_entity]
        ON [mds_audit].[change_log]([entity_id], [changed_at] DESC);
    
    -- Index for querying by business key
    CREATE NONCLUSTERED INDEX [IX_change_log_business_key]
        ON [mds_audit].[change_log]([entity_id], [business_key], [changed_at] DESC);
        
    -- Index for querying by commit
    CREATE NONCLUSTERED INDEX [IX_change_log_commit]
        ON [mds_audit].[change_log]([commit_id]);
        
    PRINT 'Created table: mds_audit.change_log';
END
GO

-- ----------------------------------------------------------------------------
-- Activity Log: Tracks user actions (login, approvals, etc.)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'activity_log' AND schema_id = SCHEMA_ID('mds_audit'))
BEGIN
    CREATE TABLE [mds_audit].[activity_log] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [user_id] NVARCHAR(255) NOT NULL,
        [user_email] NVARCHAR(255) NOT NULL,
        [action] NVARCHAR(50) NOT NULL,                  -- login, logout, approve, reject, deploy, etc.
        [resource_type] NVARCHAR(50) NULL,               -- model, entity, commit, record
        [resource_id] NVARCHAR(100) NULL,
        [details] NVARCHAR(MAX) NULL,                    -- JSON with additional details
        [ip_address] NVARCHAR(50) NULL,
        [user_agent] NVARCHAR(500) NULL,
        [created_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    -- Index for querying by user
    CREATE NONCLUSTERED INDEX [IX_activity_log_user]
        ON [mds_audit].[activity_log]([user_id], [created_at] DESC);
    
    -- Index for querying by action
    CREATE NONCLUSTERED INDEX [IX_activity_log_action]
        ON [mds_audit].[activity_log]([action], [created_at] DESC);
        
    PRINT 'Created table: mds_audit.activity_log';
END
GO

PRINT '=== Audit tables creation complete ===';
