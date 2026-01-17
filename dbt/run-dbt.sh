#!/bin/bash
# =====================================================
# MDS dbt Runner Script
# =====================================================
# Wird vom Worker aufgerufen um dbt Befehle auszuführen
# =====================================================

set -e

DBT_DIR="${DBT_PROFILES_DIR:-/app/dbt}"
DBT_TARGET="${MDS_DBT_TARGET:-dev}"

cd "$DBT_DIR"

case "$1" in
  bootstrap)
    echo "Running dbt bootstrap (creating schemas and meta tables)..."
    dbt run-operation bootstrap_mds --target "$DBT_TARGET"
    ;;
  
  deploy)
    # Wird aufgerufen wenn eine Entity deployed wird
    # Erwartet: MODEL_NAME als $2
    MODEL_NAME="$2"
    echo "Deploying model: $MODEL_NAME..."
    dbt run --select "$MODEL_NAME" --target "$DBT_TARGET"
    ;;
  
  run-master)
    # Führt alle Master Models aus (SCD2 Update)
    echo "Running all master models..."
    dbt run --select tag:master --target "$DBT_TARGET"
    ;;
  
  run-single)
    # Führt ein einzelnes Model aus
    MODEL_NAME="$2"
    echo "Running single model: $MODEL_NAME..."
    dbt run --select "$MODEL_NAME" --target "$DBT_TARGET"
    ;;
  
  test)
    # Führt dbt tests aus
    echo "Running dbt tests..."
    dbt test --target "$DBT_TARGET"
    ;;
  
  compile)
    # Kompiliert Models ohne Ausführung
    echo "Compiling dbt models..."
    dbt compile --target "$DBT_TARGET"
    ;;
  
  *)
    echo "Usage: $0 {bootstrap|deploy|run-master|run-single|test|compile} [model_name]"
    exit 1
    ;;
esac

echo "dbt command completed successfully"
