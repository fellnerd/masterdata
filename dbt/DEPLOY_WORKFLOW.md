# MDS Deploy Workflow

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    MDS Data Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  UI/API Input                                                  │
│       │                                                         │
│       ▼                                                         │
│  mds_stage.staged_record  (JSON, temporär)                     │
│       │                                                         │
│       │ Deploy API (/api/deploy)                               │
│       ▼                                                         │
│  mds_load.load_<entity>   (strukturiert)                       │
│       │                                                         │
│       │ dbt run (generate_models.py → dbt run)                 │
│       ▼                                                         │
│  mds_master.<entity>      (SCD2 historisiert)                  │
│       │                                                         │
│       │ View Deploy API (/api/views/deploy)                    │
│       ▼                                                         │
│  mds_view.v_<entity>      (Output Views → Data Vault)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Schemas

| Schema | Zweck | Erstellt durch |
|--------|-------|----------------|
| `mds_meta` | Metadata (model, entity, attribute, view) | Bootstrap |
| `mds_stage` | Staging (staged_record, commit) | Bootstrap |
| `mds_load` | Load Tabellen (load_<entity>) | Deploy API |
| `mds_master` | Master Tabellen (SCD2) | dbt run |
| `mds_view` | Output Views | View Deploy API |

## Manuelle Befehle

### 1. Model-Generierung

```bash
cd ~/projects/datavault-dbt/masterdata/dbt
source ../.venv/bin/activate

# Alle Entities
python scripts/generate_models.py

# Spezifische Entity
python scripts/generate_models.py --entity customer

# Dry-run (nur anzeigen)
python scripts/generate_models.py --dry-run
```

### 2. dbt Run

```bash
cd ~/projects/datavault-dbt/masterdata/dbt

# Alle Master Models
dbt run --select mds_master

# Spezifische Entity
dbt run --select mds_customer

# Full Refresh (nicht inkrementell)
dbt run --select mds_master --full-refresh

# Tests
dbt test --select mds_master
```

### 3. Kompletter Deploy (Kombination)

```bash
cd ~/projects/datavault-dbt/masterdata/dbt

# Alles: Models generieren + dbt run
./scripts/deploy.sh

# Nur spezifische Entity
./scripts/deploy.sh --entity customer

# Nur Models generieren
./scripts/deploy.sh --models-only

# Nur dbt run (Models existieren bereits)
./scripts/deploy.sh --dbt-only

# Full Refresh
./scripts/deploy.sh --full-refresh
```

## Workflow für neue Entity

1. **Entity in UI erstellen** (Entities Page)
2. **Attribute hinzufügen** (Attributes Page)
3. **Daten eingeben** (Data Page)
4. **Commit erstellen** (Data Page → Commit)
5. **Commit approven** (Commits Page → Review)
6. **Deploy ausführen** (Commits Page → Deploy)
   - Dies lädt Daten in `mds_load`
7. **dbt run manuell ausführen**:
   ```bash
   cd ~/projects/datavault-dbt/masterdata/dbt
   ./scripts/deploy.sh --entity <entity_code>
   ```
8. **View erstellen** (Views Page → Create)
9. **View deployen** (Views Page → Deploy)

## Zukünftig: BullMQ Integration

Die Scripts sind so designed, dass sie von einem BullMQ Worker aufgerufen werden können:

```typescript
// Beispiel Worker (später)
import { Worker } from 'bullmq'
import { exec } from 'child_process'

const worker = new Worker('mds-deploy', async (job) => {
  const { entityCode, fullRefresh } = job.data
  
  let cmd = '/home/user/projects/datavault-dbt/masterdata/dbt/scripts/deploy.sh'
  if (entityCode) cmd += ` --entity ${entityCode}`
  if (fullRefresh) cmd += ' --full-refresh'
  
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
  })
})
```

## Troubleshooting

### "Master table does not exist"

Die View kann nicht erstellt werden, weil dbt noch nicht gelaufen ist:

```bash
./scripts/deploy.sh --entity <entity_code>
```

### "No active entities found"

Keine Entities mit Status `active` in `mds_meta.entity`:

```sql
SELECT * FROM mds_meta.entity WHERE status = 'active'
```

### "Model generation failed"

Prüfe die Datenbankverbindung und ob `DATABASE_URL` gesetzt ist:

```bash
export DATABASE_URL="..."
python scripts/generate_models.py --dry-run
```
