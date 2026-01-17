#!/bin/bash
# =====================================================
# MDS Deploy Script
# =====================================================
# Führt den vollständigen Deploy-Workflow aus:
# 1. Generiert dbt Models für alle Entities
# 2. Führt dbt run für mds_master aus
# 3. Optional: Generiert Views
#
# Verwendung:
#   ./deploy.sh                  # Alle Entities
#   ./deploy.sh --entity customer # Nur Customer
#   ./deploy.sh --models-only    # Nur Models generieren
#   ./deploy.sh --dbt-only       # Nur dbt run
#
# Später: BullMQ Worker ruft dieses Script auf
# =====================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DBT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="${DBT_DIR}/../.venv"

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Args
ENTITY=""
MODELS_ONLY=false
DBT_ONLY=false
FULL_REFRESH=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --entity|-e)
            ENTITY="$2"
            shift 2
            ;;
        --models-only)
            MODELS_ONLY=true
            shift
            ;;
        --dbt-only)
            DBT_ONLY=true
            shift
            ;;
        --full-refresh)
            FULL_REFRESH=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --entity, -e NAME    Deploy specific entity only"
            echo "  --models-only        Only generate dbt models, don't run dbt"
            echo "  --dbt-only           Only run dbt, don't regenerate models"
            echo "  --full-refresh       Force full refresh (not incremental)"
            echo "  --help, -h           Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=============================================="
echo "MDS Deploy"
echo "=============================================="
echo ""

cd "$DBT_DIR"

# Activate venv if exists
if [ -d "$VENV_DIR" ]; then
    log_info "Activating virtual environment..."
    source "$VENV_DIR/bin/activate"
fi

# Step 1: Generate Models
if [ "$DBT_ONLY" = false ]; then
    log_info "Step 1: Generating dbt models..."
    
    if [ -n "$ENTITY" ]; then
        python scripts/generate_models.py --entity "$ENTITY"
    else
        python scripts/generate_models.py
    fi
    
    if [ $? -ne 0 ]; then
        log_error "Model generation failed!"
        exit 1
    fi
fi

# Step 2: Run dbt
if [ "$MODELS_ONLY" = false ]; then
    log_info "Step 2: Running dbt..."
    
    DBT_CMD="dbt run"
    
    # Select specific entity or all mds_master
    if [ -n "$ENTITY" ]; then
        DBT_CMD="$DBT_CMD --select mds_${ENTITY}"
    else
        DBT_CMD="$DBT_CMD --select mds_master"
    fi
    
    # Full refresh?
    if [ "$FULL_REFRESH" = true ]; then
        DBT_CMD="$DBT_CMD --full-refresh"
    fi
    
    log_info "Executing: $DBT_CMD"
    $DBT_CMD
    
    if [ $? -ne 0 ]; then
        log_error "dbt run failed!"
        exit 1
    fi
fi

echo ""
echo "=============================================="
log_info "Deploy completed successfully!"
echo "=============================================="

# Summary
echo ""
echo "Next steps:"
echo "  - Views erstellen: dbt run --select mds_view"
echo "  - Tests ausführen: dbt test --select mds_master"
echo ""
