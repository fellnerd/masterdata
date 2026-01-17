-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 6: Job Queue Tables
-- ============================================================================
-- Purpose: Background job management (alternative to Redis/BullMQ)
-- Target: Azure SQL Database
-- Note: Can be used alongside or instead of BullMQ for simpler deployments
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Job: Background jobs for validation, deployment, etc.
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'job' AND schema_id = SCHEMA_ID('mds_meta'))
BEGIN
    CREATE TABLE [mds_meta].[job] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [code] NVARCHAR(100) NOT NULL UNIQUE,            -- Unique job identifier
        [type] NVARCHAR(50) NOT NULL,                    -- validate, deploy, import, export
        [status] NVARCHAR(20) NOT NULL DEFAULT 'queued', -- queued, running, completed, failed
        [priority] INT NOT NULL DEFAULT 0,               -- Higher = more important
        [payload] NVARCHAR(MAX) NOT NULL,                -- JSON job parameters
        [result] NVARCHAR(MAX) NULL,                     -- JSON result or error details
        [progress] INT NULL,                             -- 0-100 percentage
        [progress_message] NVARCHAR(500) NULL,
        [entity_id] INT NULL REFERENCES [mds_meta].[entity]([id]),
        [commit_id] INT NULL,
        [queued_at] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [started_at] DATETIME2 NULL,
        [completed_at] DATETIME2 NULL,
        [created_by] NVARCHAR(100) NOT NULL,
        [worker_id] NVARCHAR(100) NULL,                  -- ID of worker processing the job
        [retry_count] INT NOT NULL DEFAULT 0,
        [max_retries] INT NOT NULL DEFAULT 3,
        CONSTRAINT [CK_job_status] CHECK ([status] IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        CONSTRAINT [CK_job_type] CHECK ([type] IN ('validate', 'deploy', 'import', 'export', 'sync', 'cleanup'))
    );
    
    -- Index for finding next job to process
    CREATE NONCLUSTERED INDEX [IX_job_queue]
        ON [mds_meta].[job]([status], [priority] DESC, [queued_at])
        WHERE [status] = 'queued';
    
    -- Index for querying by entity
    CREATE NONCLUSTERED INDEX [IX_job_entity]
        ON [mds_meta].[job]([entity_id], [queued_at] DESC);
        
    PRINT 'Created table: mds_meta.job';
END
GO

PRINT '=== Job queue tables creation complete ===';
