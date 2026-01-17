#!/bin/bash
# ============================================================================
# Master Data Services - Database Setup Script
# ============================================================================
# Purpose: Execute all SQL setup scripts against Azure SQL
# Usage: ./setup_database.sh [server] [database]
# ============================================================================

set -e

# Configuration
SERVER="${1:-sql-datavault-weu-001.database.windows.net}"
DATABASE="${2:-Vault}"
SQL_DIR="$(dirname "$0")"

echo "============================================"
echo "Master Data Services - Database Setup"
echo "============================================"
echo "Server:   $SERVER"
echo "Database: $DATABASE"
echo "============================================"
echo ""

# Check for sqlcmd
if ! command -v sqlcmd &> /dev/null; then
    echo "Error: sqlcmd is not installed."
    echo "Install it with: curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -"
    echo "                 sudo add-apt-repository 'https://packages.microsoft.com/ubuntu/$(lsb_release -rs)/prod'"
    echo "                 sudo apt-get update && sudo apt-get install mssql-tools"
    exit 1
fi

# Get Azure access token
echo "Getting Azure access token..."
ACCESS_TOKEN=$(az account get-access-token --resource https://database.windows.net --query accessToken -o tsv)

if [ -z "$ACCESS_TOKEN" ]; then
    echo "Error: Could not get Azure access token. Please run 'az login' first."
    exit 1
fi

# Execute SQL files in order
SQL_FILES=(
    "01_create_schemas.sql"
    "02_create_metadata_tables.sql"
    "03_create_staging_tables.sql"
    "04_create_load_tables.sql"
    "05_create_audit_tables.sql"
    "06_create_job_tables.sql"
    "07_insert_sample_data.sql"
)

for file in "${SQL_FILES[@]}"; do
    filepath="$SQL_DIR/$file"
    if [ -f "$filepath" ]; then
        echo ""
        echo "Executing: $file"
        echo "----------------------------------------"
        sqlcmd -S "$SERVER" -d "$DATABASE" -G -P "$ACCESS_TOKEN" -i "$filepath" -b
        if [ $? -eq 0 ]; then
            echo "✓ $file completed successfully"
        else
            echo "✗ $file failed"
            exit 1
        fi
    else
        echo "Warning: $filepath not found, skipping..."
    fi
done

echo ""
echo "============================================"
echo "Database setup complete!"
echo "============================================"
