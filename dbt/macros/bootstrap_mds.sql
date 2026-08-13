{% macro bootstrap_mds() %}
{# 
  Bootstrap-Macro für MDS Tabellen
  Wird bei Container-Start aufgerufen: dbt run-operation bootstrap_mds
#}

{% set schemas_sql %}
-- Schemas erstellen
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_meta') EXEC('CREATE SCHEMA mds_meta');
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_stage') EXEC('CREATE SCHEMA mds_stage');
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_load') EXEC('CREATE SCHEMA mds_load');
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_master') EXEC('CREATE SCHEMA mds_master');
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_view') EXEC('CREATE SCHEMA mds_view');
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'mds_audit') EXEC('CREATE SCHEMA mds_audit');
{% endset %}

{% set model_sql %}
-- mds_meta.model Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'model')
CREATE TABLE mds_meta.model (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(100) NOT NULL UNIQUE,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    version INT NOT NULL DEFAULT 1,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft',
    source_database NVARCHAR(100) NULL,
    target_schema NVARCHAR(100) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at DATETIME2,
    updated_by NVARCHAR(100)
);
{% endset %}

{% set entity_sql %}
-- mds_meta.entity Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'entity')
CREATE TABLE mds_meta.entity (
    id INT IDENTITY(1,1) PRIMARY KEY,
    model_id INT NOT NULL,
    code NVARCHAR(100) NOT NULL,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    source_schema NVARCHAR(100),
    source_table NVARCHAR(255),
    target_schema NVARCHAR(100) NOT NULL DEFAULT 'mds_master',
    target_table NVARCHAR(255) NOT NULL,
    business_key_columns NVARCHAR(MAX) NOT NULL,
    staging_view NVARCHAR(255) NULL,
    hub_name NVARCHAR(255) NULL,
    is_deployed BIT NOT NULL DEFAULT 0,
    last_deployed_at DATETIME2 NULL,
    record_count INT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    -- Neue Spalten für API-Kompatibilität
    status NVARCHAR(20) NOT NULL DEFAULT 'draft',
    scd_type NVARCHAR(10) NOT NULL DEFAULT 'SCD2',  -- 'SCD1' or 'SCD2'
    primary_key_attribute NVARCHAR(100) NULL,
    -- Import-Konfiguration (Data Vault → MDS)
    import_source_object NVARCHAR(255) NULL,        -- z.B. 'vault.hub_company'
    import_column_mapping NVARCHAR(MAX) NULL,       -- JSON: {"mds_attr": "dv_column"}
    import_filter NVARCHAR(MAX) NULL,               -- WHERE-Bedingung
    import_schedule NVARCHAR(100) NULL,             -- Cron-Expression
    last_import_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at DATETIME2,
    updated_by NVARCHAR(100),
    CONSTRAINT FK__entity__model_id FOREIGN KEY (model_id) REFERENCES mds_meta.model(id),
    CONSTRAINT UQ__entity__model_code UNIQUE (model_id, code)
);

-- Optional change-detection column for imports (e.g. a Satellite's hashdiff,
-- or any other column). Left NULL: import stays full delete+reinsert, as
-- before. Set: import switches to skip-unchanged/merge-changed per business
-- key instead - see import_from_datavault.sql.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.entity') AND name = 'import_tracking_column')
BEGIN
    ALTER TABLE mds_meta.entity ADD import_tracking_column NVARCHAR(255) NULL;
END
{% endset %}

{% set attribute_sql %}
-- mds_meta.attribute Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'attribute')
CREATE TABLE mds_meta.attribute (
    id INT IDENTITY(1,1) PRIMARY KEY,
    entity_id INT NOT NULL,
    code NVARCHAR(100) NOT NULL,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    data_type NVARCHAR(100) NOT NULL,
    sql_type NVARCHAR(100) NULL,
    max_length INT,
    precision INT NULL,
    scale INT NULL,
    is_nullable BIT NOT NULL DEFAULT 1,
    is_business_key BIT NOT NULL DEFAULT 0,
    is_required BIT NOT NULL DEFAULT 0,
    is_unique BIT NOT NULL DEFAULT 0,
    reference_entity_id INT NULL,
    default_value NVARCHAR(MAX),
    validation_regex NVARCHAR(500),
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at DATETIME2 NULL,
    updated_by NVARCHAR(100) NULL,
    CONSTRAINT FK__attribute__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id),
    CONSTRAINT FK__attribute__reference_entity FOREIGN KEY (reference_entity_id) REFERENCES mds_meta.entity(id),
    CONSTRAINT UQ__attribute__entity_code UNIQUE (entity_id, code)
);
{% endset %}

{% set entity_view_sql %}
-- mds_meta.entity_view Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'entity_view')
CREATE TABLE mds_meta.entity_view (
    id INT IDENTITY(1,1) PRIMARY KEY,
    entity_id INT NOT NULL,
    code NVARCHAR(100) NOT NULL,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    view_type NVARCHAR(50) NOT NULL DEFAULT 'scd1',
    custom_sql NVARCHAR(MAX) NULL,
    column_config NVARCHAR(MAX) NULL,
    filter_condition NVARCHAR(MAX) NULL,
    filter_expression NVARCHAR(MAX) NULL,
    is_default BIT NOT NULL DEFAULT 0,
    is_deployed BIT NOT NULL DEFAULT 0,
    is_active BIT NOT NULL DEFAULT 1,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft',
    last_deployed_at DATETIME2 NULL,
    deployed_at DATETIME2 NULL,
    deployed_by NVARCHAR(100) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at DATETIME2 NULL,
    updated_by NVARCHAR(100) NULL,
    CONSTRAINT FK__entity_view__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id),
    CONSTRAINT UQ__entity_view__entity_code UNIQUE (entity_id, code)
);
{% endset %}

{% set staged_record_sql %}
-- mds_stage.staged_record Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_stage' AND t.name = 'staged_record')
CREATE TABLE mds_stage.staged_record (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    entity_id INT NOT NULL,
    business_key_hash CHAR(64) NOT NULL,
    business_key NVARCHAR(MAX) NULL,
    payload NVARCHAR(MAX) NOT NULL,
    data NVARCHAR(MAX) NULL,
    previous_data NVARCHAR(MAX) NULL,
    commit_id INT NULL,
    operation NVARCHAR(10) NOT NULL DEFAULT 'UPSERT',
    status NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
    validation_errors NVARCHAR(MAX),
    source_system NVARCHAR(100),
    source_id NVARCHAR(255),
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    processed_at DATETIME2,
    processed_by NVARCHAR(100),
    CONSTRAINT FK__staged_record__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id)
);

-- Tracking-column value seen at this row's last import, for change
-- detection when entity.import_tracking_column is set.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('mds_stage.staged_record') AND name = 'source_tracking_value')
BEGIN
    ALTER TABLE mds_stage.staged_record ADD source_tracking_value NVARCHAR(500) NULL;
END
{% endset %}

{% set commit_sql %}
-- mds_stage.commit Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_stage' AND t.name = 'commit')
CREATE TABLE mds_stage.[commit] (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(50) NOT NULL,
    description NVARCHAR(500) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    entity_id INT NULL,
    record_count INT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    approved_at DATETIME2 NULL,
    approved_by NVARCHAR(100) NULL,
    rejected_at DATETIME2 NULL,
    rejected_by NVARCHAR(100) NULL,
    review_comment NVARCHAR(MAX) NULL,
    deployed_at DATETIME2 NULL,
    deployed_by NVARCHAR(100) NULL,
    CONSTRAINT FK__commit__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id)
);
{% endset %}

{% set index_sql %}
-- Indices für staged_record
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_staged_record_entity_status')
CREATE INDEX IX_staged_record_entity_status ON mds_stage.staged_record(entity_id, status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_staged_record_business_key')
CREATE INDEX IX_staged_record_business_key ON mds_stage.staged_record(business_key_hash);
{% endset %}

{% set deployment_log_sql %}
-- mds_load.deployment_log Tabelle
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_load' AND t.name = 'deployment_log')
CREATE TABLE mds_load.deployment_log (
    id INT IDENTITY(1,1) PRIMARY KEY,
    deployment_id NVARCHAR(100) NOT NULL,
    commit_id INT NULL,
    entity_id INT NOT NULL,
    entity_code NVARCHAR(100) NOT NULL,
    records_deployed INT NOT NULL DEFAULT 0,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    completed_at DATETIME2 NULL,
    error_message NVARCHAR(MAX) NULL,
    deployed_by NVARCHAR(100) NOT NULL DEFAULT 'system',
    CONSTRAINT FK__deployment_log__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id)
);
{% endset %}

{% set schema_deployment_sql %}
-- mds_meta.schema_deployment Tabelle (Schema-Änderungen für Deploy-Queue)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'schema_deployment')
CREATE TABLE mds_meta.schema_deployment (
    id INT IDENTITY(1,1) PRIMARY KEY,
    entity_id INT NOT NULL UNIQUE,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NULL,
    deployed_at DATETIME2 NULL,
    deployed_by NVARCHAR(100) NULL,
    CONSTRAINT FK__schema_deployment__entity_id FOREIGN KEY (entity_id) 
        REFERENCES mds_meta.entity(id) ON DELETE CASCADE
);
{% endset %}

{% set import_source_sql %}
-- mds_meta.import_source Tabelle (Data Vault Import-Konfiguration)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'import_source')
CREATE TABLE mds_meta.import_source (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL DEFAULT 'default',
    git_url NVARCHAR(500) NULL,
    git_branch NVARCHAR(100) NOT NULL DEFAULT 'main',
    dbt_project_path NVARCHAR(500) NOT NULL DEFAULT '/',
    dbt_target NVARCHAR(100) NULL,
    local_path NVARCHAR(500) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'disconnected',
    last_connected_at DATETIME2 NULL,
    error_message NVARCHAR(MAX) NULL,
    project_name NVARCHAR(100) NULL,
    models_json NVARCHAR(MAX) NULL,
    -- dbt Profile Connection Settings
    profile_name NVARCHAR(100) NULL,
    db_server NVARCHAR(500) NULL,
    db_port INT NULL DEFAULT 1433,
    db_database NVARCHAR(100) NULL,
    db_schema NVARCHAR(100) NULL DEFAULT 'dbo',
    db_auth_type NVARCHAR(20) NULL DEFAULT 'sql',
    db_user NVARCHAR(100) NULL,
    db_password NVARCHAR(500) NULL,
    db_encrypt BIT NULL DEFAULT 1,
    db_trust_cert BIT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NULL,
    CONSTRAINT CK_import_source_status CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
    CONSTRAINT CK_import_source_auth_type CHECK (db_auth_type IN ('sql', 'cli', 'msi', 'auto'))
);

-- Neue Spalten hinzufügen falls Tabelle schon existiert
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.import_source') AND name = 'profile_name')
BEGIN
    ALTER TABLE mds_meta.import_source ADD profile_name NVARCHAR(100) NULL;
    ALTER TABLE mds_meta.import_source ADD db_server NVARCHAR(500) NULL;
    ALTER TABLE mds_meta.import_source ADD db_port INT NULL DEFAULT 1433;
    ALTER TABLE mds_meta.import_source ADD db_database NVARCHAR(100) NULL;
    ALTER TABLE mds_meta.import_source ADD db_schema NVARCHAR(100) NULL DEFAULT 'dbo';
    ALTER TABLE mds_meta.import_source ADD db_auth_type NVARCHAR(20) NULL DEFAULT 'sql';
    ALTER TABLE mds_meta.import_source ADD db_user NVARCHAR(100) NULL;
    ALTER TABLE mds_meta.import_source ADD db_password NVARCHAR(500) NULL;
    ALTER TABLE mds_meta.import_source ADD db_encrypt BIT NULL DEFAULT 1;
    ALTER TABLE mds_meta.import_source ADD db_trust_cert BIT NULL DEFAULT 0;
END

-- Git-Auth (SSH Deploy Key fuer private Repos) + GitHub Actions
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('mds_meta.import_source') AND name = 'git_auth_type')
BEGIN
    ALTER TABLE mds_meta.import_source ADD git_auth_type NVARCHAR(20) NOT NULL DEFAULT 'none';
    ALTER TABLE mds_meta.import_source ADD git_ssh_private_key NVARCHAR(MAX) NULL;
    ALTER TABLE mds_meta.import_source ADD github_api_token NVARCHAR(500) NULL;
    ALTER TABLE mds_meta.import_source ADD workflows_json NVARCHAR(MAX) NULL;
END

-- Default-Eintrag wenn nicht vorhanden
IF NOT EXISTS (SELECT 1 FROM mds_meta.import_source WHERE name = 'default')
INSERT INTO mds_meta.import_source (name) VALUES ('default');
{% endset %}

{% set job_sql %}
-- mds_meta.job Tabelle (Job-History für Audit-Zwecke)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'job')
CREATE TABLE mds_meta.job (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(100) NOT NULL UNIQUE,
    [type] NVARCHAR(50) NOT NULL,
    name NVARCHAR(200) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'queued',
    priority INT NOT NULL DEFAULT 0,
    payload NVARCHAR(MAX) NOT NULL,
    result NVARCHAR(MAX) NULL,
    progress INT NULL DEFAULT 0,
    progress_message NVARCHAR(500) NULL,
    logs NVARCHAR(MAX) NULL,
    error NVARCHAR(MAX) NULL,
    entity_id INT NULL,
    commit_id INT NULL,
    queued_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    started_at DATETIME2 NULL,
    completed_at DATETIME2 NULL,
    created_by NVARCHAR(100) NOT NULL,
    worker_id NVARCHAR(100) NULL,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    CONSTRAINT CK_job_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT CK_job_type CHECK ([type] IN ('validate', 'deploy', 'import', 'export', 'sync', 'cleanup', 'dbt-run', 'dbt-test', 'schema-deploy')),
    CONSTRAINT FK__job__entity_id FOREIGN KEY (entity_id) REFERENCES mds_meta.entity(id)
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_job_queue')
CREATE INDEX IX_job_queue ON mds_meta.job(status, priority DESC, queued_at);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_job_entity')
CREATE INDEX IX_job_entity ON mds_meta.job(entity_id, queued_at DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_job_type_status')
CREATE INDEX IX_job_type_status ON mds_meta.job([type], status);
{% endset %}

{% set user_sql %}
-- mds_meta.user Tabelle (Identity - eine Zeile pro Login-Konto)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'user')
CREATE TABLE mds_meta.[user] (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL UNIQUE,
    name NVARCHAR(255) NULL,
    image NVARCHAR(MAX) NULL,
    external_id NVARCHAR(255) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NULL,
    last_login_at DATETIME2 NULL,
    CONSTRAINT CK_user_status CHECK (status IN ('active', 'inactive', 'pending'))
);

-- Widen image column if an older deploy already created it too small.
-- Microsoft Entra ID returns the profile photo as a base64 data URI (several
-- KB), which overflowed the original NVARCHAR(500) and silently broke user
-- provisioning on real OAuth logins.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('mds_meta.[user]') AND name = 'image' AND max_length != -1
)
ALTER TABLE mds_meta.[user] ALTER COLUMN image NVARCHAR(MAX) NULL;
{% endset %}

{% set user_role_sql %}
-- mds_meta.user_role Tabelle (Rollenzuweisung, optional pro Model gescoped)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'user_role')
CREATE TABLE mds_meta.user_role (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    role NVARCHAR(20) NOT NULL,
    model_id INT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NULL,
    CONSTRAINT CK_user_role_role CHECK (role IN ('viewer', 'editor', 'approver', 'admin')),
    CONSTRAINT FK__user_role__user_id FOREIGN KEY (user_id) REFERENCES mds_meta.[user](id) ON DELETE CASCADE,
    CONSTRAINT FK__user_role__model_id FOREIGN KEY (model_id) REFERENCES mds_meta.model(id)
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_user_role_user_id')
CREATE INDEX IX_user_role_user_id ON mds_meta.user_role(user_id);
{% endset %}

{% set api_token_sql %}
-- mds_meta.api_token Tabelle (gehashte API-Tokens pro User)
IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'mds_meta' AND t.name = 'api_token')
CREATE TABLE mds_meta.api_token (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    token_prefix NVARCHAR(20) NOT NULL,
    scopes NVARCHAR(500) NOT NULL,
    expires_at DATETIME2 NULL,
    last_used_at DATETIME2 NULL,
    revoked_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NULL,
    CONSTRAINT FK__api_token__user_id FOREIGN KEY (user_id) REFERENCES mds_meta.[user](id) ON DELETE CASCADE,
    CONSTRAINT UQ__api_token__hash UNIQUE (token_hash)
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_api_token_user_id')
CREATE INDEX IX_api_token_user_id ON mds_meta.api_token(user_id);
{% endset %}

-- Ausführen
{{ log("Creating MDS schemas...", info=True) }}
{% do run_query(schemas_sql) %}

{{ log("Creating mds_meta.model table...", info=True) }}
{% do run_query(model_sql) %}

{{ log("Creating mds_meta.entity table...", info=True) }}
{% do run_query(entity_sql) %}

{{ log("Creating mds_meta.attribute table...", info=True) }}
{% do run_query(attribute_sql) %}

{{ log("Creating mds_meta.entity_view table...", info=True) }}
{% do run_query(entity_view_sql) %}

{{ log("Creating mds_stage.staged_record table...", info=True) }}
{% do run_query(staged_record_sql) %}

{{ log("Creating mds_stage.commit table...", info=True) }}
{% do run_query(commit_sql) %}

{{ log("Creating indices...", info=True) }}
{% do run_query(index_sql) %}

{{ log("Creating mds_load.deployment_log table...", info=True) }}
{% do run_query(deployment_log_sql) %}

{{ log("Creating mds_meta.schema_deployment table...", info=True) }}
{% do run_query(schema_deployment_sql) %}

{{ log("Creating mds_meta.import_source table...", info=True) }}
{% do run_query(import_source_sql) %}

{{ log("Creating mds_meta.job table...", info=True) }}
{% do run_query(job_sql) %}

{{ log("Creating mds_meta.user table...", info=True) }}
{% do run_query(user_sql) %}

{{ log("Creating mds_meta.user_role table...", info=True) }}
{% do run_query(user_role_sql) %}

{{ log("Creating mds_meta.api_token table...", info=True) }}
{% do run_query(api_token_sql) %}

{{ log("MDS Bootstrap completed successfully!", info=True) }}

{% endmacro %}
