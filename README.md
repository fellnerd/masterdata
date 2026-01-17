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

```bash
# Alle Services starten (App + Worker + Redis)
docker-compose up -d

# Logs ansehen
docker-compose logs -f

# Stoppen
docker-compose down
```

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

| Variable | Beschreibung | Standard |
|----------|-------------|----------|
| `AUTH_SECRET` | NextAuth Secret | - |
| `DB_SERVER` | Azure SQL Server | - |
| `DB_NAME` | Datenbankname | `Vault` |
| `DB_MOCK` | Mock-Modus | `false` |
| `REDIS_HOST` | Redis Host | `localhost` |
| `QUEUE_MOCK` | Queue Mock-Modus | `false` |
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

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
