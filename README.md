# Master Data Services (MDS)

Eine moderne Master Data Management Lösung basierend auf Next.js und Blueprint.js.

## 🚀 Features

- **Model-basiertes Design**: Definiere Datenmodelle, Entitäten und Attribute
- **Staging & Commit**: Git-ähnlicher Workflow für Datenänderungen
- **Validation**: Konfigurierbare Validierungsregeln
- **Deployment**: Automatische Synchronisation mit Azure SQL via dbt
- **Job Queue**: Asynchrone Verarbeitung mit BullMQ
- **Auth**: Microsoft Entra ID (Azure AD) Integration

## 📋 Voraussetzungen

- Node.js 22+
- npm 10+
- Redis (für Job Queue)
- Azure SQL Database

## 🛠 Installation

```bash
# Kill
pkill -f "npm" 2>/dev/null; pkill -f "next" 2>/dev/null; echo "Done"

# Dependencies installieren
npm install --legacy-peer-deps


# Umgebungsvariablen konfigurieren
cp .env.example .env.local
# .env.local bearbeiten und Werte eintragen

# Development Server starten
npm run dev:webpack
```

## 🐳 Docker Deployment

Diese Anleitung ist so geschrieben, dass sie ohne weiteren Kontext (auch von
einem KI-Agenten) ausführbar ist - inklusive der Stolperfallen, die beim
Aufsetzen typischerweise auftreten.

### Architektur

Zwei Container, ein `docker-compose.yml`:

- **`mds-app`** - Next.js Frontend + API (Port 3000), enthält das embedded
  dbt-Projekt (`./dbt`) und führt beim Start einmalig `dbt run-operation
  bootstrap_mds` aus (legt `mds_meta`-Schema/Tabellen idempotent an).
- **`mds-worker`** - BullMQ Job-Prozessor (kein Port), führt strukturierte
  dbt-Kommandos (`schema-deploy`, `deploy`, Data-Vault-Import) ausschließlich
  gegen das **eigene** embedded dbt-Projekt aus - niemals gegen extern via
  Settings→Config verbundene (nur lesend erlaubte) dbt-Projekte.
- **Redis** ist kein eigener Container in `docker-compose.yml` - beide
  Services verbinden sich standardmäßig zu Upstash (cloud) über
  `UPSTASH_REDIS_URL`. Für selbst gehostetes Redis siehe unten.
- Beide Container erreichen sich im selben Compose-Netzwerk über ihren
  Service-Namen (`mds-app`, `mds-worker`), **nicht** über `localhost` - jeder
  Container hat sein eigenes Loopback-Interface.

### Schritt für Schritt

```bash
# 1. Repo klonen (falls noch nicht vorhanden)
git clone git@github.com:fellnerd/masterdata.git
cd masterdata

# 2. .env aus Vorlage anlegen und ALLE Pflichtwerte eintragen
cp .env.example .env
```

In `.env` müssen mindestens gesetzt werden (siehe Abschnitt "Umgebungsvariablen"
weiter unten für die vollständige Liste, [.env.example](.env.example) für Kommentare):

- `AUTH_SECRET` - `openssl rand -base64 32`
- `AUTH_URL` - die öffentliche URL, unter der die App erreichbar sein wird (z. B. `https://mds.example.com`)
- `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - Azure SQL Verbindung
- `INTERNAL_API_SECRET` - `openssl rand -hex 32` (muss in App und Worker identisch sein; wird von docker-compose automatisch in beide Container injiziert)
- `UPSTASH_REDIS_URL` - Upstash (cloud) Redis-Connection-String

Es gibt **keine** funktionierenden Standardwerte für diese Variablen im
Code oder in `docker-compose.yml` - ein leerer Wert führt zu einem klaren
Verbindungsfehler beim Start, nicht zu einer stillen Fehlkonfiguration.

```bash
# 3. Beide Container bauen und starten
docker-compose up -d --build

# 4. Logs verfolgen - insbesondere den dbt-Bootstrap-Output von mds-app
#    ("Running with dbt=..." / "Completed successfully" o.ä.) und den
#    Worker-Start ("MDS Worker started, waiting for jobs...")
docker-compose logs -f

# 5. Health-Check
curl -f http://localhost:3000/api/health
# erwartet: {"status":"healthy", ...}

# Stoppen
docker-compose down
```

### Bekannte Stolperfallen (bereits im Repo behoben, aber gut zu wissen)

- **Alpine-Basisimage ist bewusst auf `node:22-alpine3.21` gepinnt**, nicht
  das floatende `node:22-alpine`. Neuere Alpine-Releases liefern Python 3.14
  aus, dessen C-API-Änderung den Build von `pyodbc` (Abhängigkeit von
  `dbt-sqlserver==1.9.0`) mit `error: too few arguments to function
  '_PyLong_AsByteArray'` scheitern lässt. Nicht auf `node:22-alpine`
  zurückändern, ohne vorher zu prüfen, welche Python-Version die gewählte
  Alpine-Version mitbringt (muss ≤ 3.12 sein).
- **`docker buildx` Fehler `lease does not exist: not found`** beim Pull des
  Basisimages ist ein lokales Docker-Desktop-Cache-Problem, kein
  Dockerfile-Fehler. Fix: `docker buildx prune -af` und erneut bauen.
- **`DBT_TARGET`** (nicht `MDS_DBT_TARGET` o. ä.) ist der Variablenname, den
  sowohl `worker.ts` als auch `dbt/profiles.yml` lesen. Ein falscher
  Variablenname führt dazu, dass dbt-Kommandos still auf das `local`-Target
  zurückfallen.
- Worker → App Kommunikation läuft über `API_BASE_URL=http://mds-app:3000`
  (Compose-Service-Name). Mit `localhost` erreicht der Worker-Container die
  App nicht.

### Alternative: selbst gehostetes Redis

`docker-compose.redis.yml` startet einen lokalen Redis-Container als
Alternative zu Upstash:

```bash
docker-compose -f docker-compose.yml -f docker-compose.redis.yml up -d --build
```

Dann in `.env`: `UPSTASH_REDIS_URL` leer lassen und `REDIS_HOST=redis` setzen.

## 📁 Projektstruktur

```
masterdata/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API Routes
│   │   │   ├── health/        # Health Check
│   │   │   ├── jobs/          # Job Queue API
│   │   │   ├── models/        # Models CRUD
│   │   │   ├── entities/      # Entities CRUD
│   │   │   └── users/         # User Management
│   │   ├── (pages)/           # UI Pages
│   │   └── layout.tsx         # Root Layout
│   ├── components/            # React Components
│   │   ├── layout/           # Layout Components
│   │   └── ui/               # UI Components
│   └── lib/                   # Shared Libraries
│       ├── auth.ts           # NextAuth Configuration
│       ├── db-server.ts      # Database Access (Server Actions)
│       └── queue/            # BullMQ Configuration
│           ├── config.ts     # Queue Settings
│           ├── queue.ts      # Queue Instance
│           └── worker.ts     # Job Worker
├── sql/                       # Database Schema
│   ├── 00_run_all.sql        # Master Script
│   ├── 01_create_schemas.sql # Schema Definitions
│   └── ...
├── Dockerfile                 # App Container
├── Dockerfile.worker          # Worker Container
├── docker-compose.yml         # Docker Orchestration
└── .env.example              # Environment Template
```

## 🗄 Datenbank Schema

| Schema | Beschreibung |
|--------|-------------|
| `mds_meta` | Metadata (Models, Entities, Attributes, Validation Rules) |
| `mds_stage` | Staging Area (Commits, Staged Records, Validation Results) |
| `mds_load` | Load Area (Master Records, Deployment Log) |
| `mds_view` | Business Views |
| `mds_audit` | Audit Log (Change Log, Activity Log) |

## 🔧 Umgebungsvariablen

Vollständige, aktuelle Liste in [.env.example](.env.example). Wichtigste Pflichtwerte:

| Variable | Beschreibung | Standard |
|----------|-------------|----------|
| `AUTH_SECRET` | NextAuth Secret (`openssl rand -base64 32`) | - |
| `AUTH_URL` | Öffentliche URL der App (OAuth-Callbacks) | - |
| `DB_SERVER` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Azure SQL Verbindung | - |
| `INTERNAL_API_SECRET` | Shared Secret Worker↔App (`openssl rand -hex 32`) | - |
| `UPSTASH_REDIS_URL` | Upstash Redis (cloud) | - |
| `REDIS_HOST` / `REDIS_PORT` | Alternative: selbst gehostetes Redis | - |
| `DBT_TARGET` | dbt Profile-Target beider Container | `prod` |
| `DB_MOCK` | Mock-Modus (kein DB-Zugriff) | `false` |
| `QUEUE_MOCK` | Queue Mock-Modus (kein Redis) | `false` |
| `NEXT_PUBLIC_DEV_MODE` | Dev Login aktivieren | `false` |

## 📡 API Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/health` | GET | Health Check |
| `/api/models` | GET, POST | Models CRUD |
| `/api/entities` | GET, POST | Entities CRUD |
| `/api/users` | GET, POST, DELETE | User Management |
| `/api/jobs` | GET, POST, DELETE | Job Queue |

## 🧪 Development

```bash
# Dev Server (mit Turbopack - schneller)
npm run dev

# Dev Server (mit Webpack - stabiler für mssql)
npm run dev:webpack

# Worker starten (separates Terminal)
npm run worker:dev

# Linting
npm run lint

# Build
npm run build
```

## 📝 License

MIT
