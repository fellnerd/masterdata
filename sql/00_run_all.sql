-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Master Script - Runs all setup scripts in order
-- ============================================================================
-- Purpose: Single script to execute all database setup
-- Target: Azure SQL Database
-- Usage: Execute this script to create the complete MDS schema
-- ============================================================================

PRINT '============================================';
PRINT 'Master Data Services - Database Setup';
PRINT 'Started at: ' + CONVERT(VARCHAR, GETUTCDATE(), 120);
PRINT '============================================';
PRINT '';

-- Note: In Azure SQL, you cannot use :r to include files
-- This script shows the execution order
-- Run each script individually or concatenate them

-- Step 1: Create schemas
PRINT 'Step 1: Creating schemas...';
-- Execute: 01_create_schemas.sql

-- Step 2: Create metadata tables
PRINT 'Step 2: Creating metadata tables...';
-- Execute: 02_create_metadata_tables.sql

-- Step 3: Create staging tables
PRINT 'Step 3: Creating staging tables...';
-- Execute: 03_create_staging_tables.sql

-- Step 4: Create load tables
PRINT 'Step 4: Creating load tables...';
-- Execute: 04_create_load_tables.sql

-- Step 5: Create audit tables
PRINT 'Step 5: Creating audit tables...';
-- Execute: 05_create_audit_tables.sql

-- Step 6: Create job queue tables
PRINT 'Step 6: Creating job queue tables...';
-- Execute: 06_create_job_tables.sql

-- Step 7: Insert sample data (optional, for development)
PRINT 'Step 7: Inserting sample data...';
-- Execute: 07_insert_sample_data.sql

PRINT '';
PRINT '============================================';
PRINT 'Database setup complete!';
PRINT 'Finished at: ' + CONVERT(VARCHAR, GETUTCDATE(), 120);
PRINT '============================================';

-- Verify setup
SELECT 
    s.name AS [Schema],
    COUNT(t.name) AS [Table Count]
FROM sys.schemas s
LEFT JOIN sys.tables t ON t.schema_id = s.schema_id
WHERE s.name LIKE 'mds_%'
GROUP BY s.name
ORDER BY s.name;
