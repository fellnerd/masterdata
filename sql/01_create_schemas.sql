-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 1: Create Schemas
-- ============================================================================
-- Purpose: Creates the required schemas for the MDS application
-- Target: Azure SQL Database
-- ============================================================================

-- Metadata Schema: Model definitions, entity configurations, validation rules
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_meta')
BEGIN
    EXEC('CREATE SCHEMA [mds_meta]');
    PRINT 'Created schema: mds_meta';
END
GO

-- Staging Schema: Incoming data before validation
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_stage')
BEGIN
    EXEC('CREATE SCHEMA [mds_stage]');
    PRINT 'Created schema: mds_stage';
END
GO

-- Load Schema: Approved and validated master data
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_load')
BEGIN
    EXEC('CREATE SCHEMA [mds_load]');
    PRINT 'Created schema: mds_load';
END
GO

-- View Schema: Published views for consumption
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_view')
BEGIN
    EXEC('CREATE SCHEMA [mds_view]');
    PRINT 'Created schema: mds_view';
END
GO

-- Audit Schema: Change tracking and history
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_audit')
BEGIN
    EXEC('CREATE SCHEMA [mds_audit]');
    PRINT 'Created schema: mds_audit';
END
GO

PRINT '=== Schema creation complete ===';
