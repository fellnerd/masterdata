-- ============================================================================
-- Master Data Services - Database Schema Setup
-- Part 7: Sample Data for Development
-- ============================================================================
-- Purpose: Insert sample data for testing
-- Target: Azure SQL Database
-- ============================================================================

-- Insert default configuration values
MERGE [mds_meta].[configuration] AS target
USING (VALUES 
    ('dbt.project_path', '/home/user/projects/datavault-dbt', 'Path to dbt project directory', 'string'),
    ('dbt.target', 'dev', 'Default dbt target profile', 'string'),
    ('dbt.threads', '4', 'Number of dbt threads', 'integer'),
    ('workflow.require_approval', 'true', 'Whether commits require approval before deployment', 'boolean'),
    ('workflow.auto_validate', 'true', 'Automatically validate records on stage', 'boolean'),
    ('system.log_level', 'info', 'Application log level', 'string'),
    ('system.max_batch_size', '1000', 'Maximum records per batch operation', 'integer')
) AS source ([key], [value], [description], [data_type])
ON target.[key] = source.[key]
WHEN NOT MATCHED THEN
    INSERT ([key], [value], [description], [data_type], [updated_by])
    VALUES (source.[key], source.[value], source.[description], source.[data_type], 'system');
GO

-- Insert sample model
IF NOT EXISTS (SELECT 1 FROM [mds_meta].[model] WHERE [code] = 'CRM')
BEGIN
    INSERT INTO [mds_meta].[model] ([code], [name], [description], [status], [source_database], [target_schema], [created_by], [updated_by])
    VALUES ('CRM', 'CRM Master Data', 'Customer Relationship Management master data including customers, contacts, and relationships', 'active', 'werkportal', 'vault', 'admin', 'admin');
    PRINT 'Inserted sample model: CRM';
END
GO

-- Insert sample entities
DECLARE @model_id INT = (SELECT [id] FROM [mds_meta].[model] WHERE [code] = 'CRM');

IF NOT EXISTS (SELECT 1 FROM [mds_meta].[entity] WHERE [code] = 'customer' AND [model_id] = @model_id)
BEGIN
    INSERT INTO [mds_meta].[entity] ([model_id], [code], [name], [description], [source_table], [staging_view], [hub_name], [is_deployed], [created_by], [updated_by])
    VALUES 
        (@model_id, 'customer', 'Customer', 'Customer master data', 'public.company_client', 'stg_company_client', 'hub_company_client', 1, 'admin', 'admin'),
        (@model_id, 'contact', 'Contact', 'Customer contacts', 'public.contact', 'stg_contact', 'hub_contact', 0, 'admin', 'admin'),
        (@model_id, 'country', 'Country', 'Country reference data', 'public.country', 'stg_country', 'hub_country', 1, 'admin', 'admin');
    PRINT 'Inserted sample entities';
END
GO

-- Insert sample attributes for Customer entity
DECLARE @entity_id INT = (SELECT [id] FROM [mds_meta].[entity] WHERE [code] = 'customer');

IF NOT EXISTS (SELECT 1 FROM [mds_meta].[attribute] WHERE [entity_id] = @entity_id)
BEGIN
    INSERT INTO [mds_meta].[attribute] ([entity_id], [code], [name], [data_type], [sql_type], [is_business_key], [is_required], [is_unique], [max_length], [sort_order], [created_by], [updated_by])
    VALUES 
        (@entity_id, 'customer_id', 'Customer ID', 'integer', 'INT', 1, 1, 1, NULL, 1, 'admin', 'admin'),
        (@entity_id, 'name', 'Company Name', 'string', 'NVARCHAR(255)', 0, 1, 0, 255, 2, 'admin', 'admin'),
        (@entity_id, 'email', 'Email Address', 'string', 'NVARCHAR(255)', 0, 0, 0, 255, 3, 'admin', 'admin'),
        (@entity_id, 'phone', 'Phone Number', 'string', 'NVARCHAR(50)', 0, 0, 0, 50, 4, 'admin', 'admin'),
        (@entity_id, 'address', 'Address', 'string', 'NVARCHAR(500)', 0, 0, 0, 500, 5, 'admin', 'admin'),
        (@entity_id, 'city', 'City', 'string', 'NVARCHAR(100)', 0, 0, 0, 100, 6, 'admin', 'admin'),
        (@entity_id, 'country_id', 'Country', 'reference', 'INT', 0, 0, 0, NULL, 7, 'admin', 'admin'),
        (@entity_id, 'is_active', 'Active', 'boolean', 'BIT', 0, 1, 0, NULL, 8, 'admin', 'admin');
    PRINT 'Inserted sample attributes for Customer';
END
GO

-- Insert sample validation rules
DECLARE @customer_entity_id INT = (SELECT [id] FROM [mds_meta].[entity] WHERE [code] = 'customer');

IF NOT EXISTS (SELECT 1 FROM [mds_meta].[validation_rule] WHERE [entity_id] = @customer_entity_id)
BEGIN
    INSERT INTO [mds_meta].[validation_rule] ([entity_id], [code], [name], [rule_type], [severity], [expression], [error_message], [created_by], [updated_by])
    VALUES 
        (@customer_entity_id, 'req_customer_id', 'Customer ID Required', 'required', 'error', 'customer_id IS NOT NULL', 'Customer ID is required', 'admin', 'admin'),
        (@customer_entity_id, 'req_name', 'Name Required', 'required', 'error', 'name IS NOT NULL AND LEN(name) > 0', 'Company name is required', 'admin', 'admin'),
        (@customer_entity_id, 'unq_customer_id', 'Unique Customer ID', 'unique', 'error', 'customer_id', 'Customer ID must be unique', 'admin', 'admin'),
        (@customer_entity_id, 'val_email', 'Valid Email Format', 'regex', 'warning', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', 'Email format is invalid', 'admin', 'admin');
    PRINT 'Inserted sample validation rules';
END
GO

-- Insert sample user roles
IF NOT EXISTS (SELECT 1 FROM [mds_meta].[user_role] WHERE [email] = 'admin@example.com')
BEGIN
    INSERT INTO [mds_meta].[user_role] ([user_id], [email], [display_name], [role], [created_by])
    VALUES 
        ('dev-admin-001', 'admin@example.com', 'Admin User', 'admin', 'system'),
        ('dev-editor-001', 'editor@example.com', 'Editor User', 'editor', 'system'),
        ('dev-approver-001', 'approver@example.com', 'Approver User', 'approver', 'system'),
        ('dev-viewer-001', 'viewer@example.com', 'Viewer User', 'viewer', 'system');
    PRINT 'Inserted sample user roles';
END
GO

PRINT '=== Sample data insertion complete ===';
