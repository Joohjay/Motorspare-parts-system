# JM SPAREPARTS

Motorcycle spare parts management system.

A production-quality application for managing motorcycle spare parts, product
catalog, suppliers, purchasing, receiving, inventory, retail and wholesale
sales, discounts, payments, customer and supplier credit, returns, expenses,
reporting, notifications and audit history.

## Status

**Stage 9 — Production ready.** All 9 stages complete. 218/218 automated
tests pass. Database integrity verified (51 CHECK constraints, 58 FKs,
107 indexes). RBAC enforced across all 101 routes. Audit trail covers all
business mutations. See `docs/stage-9-report.md` for the full report.

## Features

- **Authentication & RBAC** — Email/password login with httpOnly cookies,
  CSRF protection, admin/assistant roles, account status management
- **Product Catalog** — Products with SKUs, OEM/part numbers, brands,
  categories, motorcycle compatibility mapping
- **Inventory** — Weighted average costing, stock in/out/adjust, reservations,
  low-stock notifications, transaction ledger
- **Purchasing** — Purchase orders, supplier management, receiving with
  quality inspection, purchase returns
- **Sales/POS** — Retail & wholesale pricing, split payments (cash/mpesa/
  credit), price overrides (admin only), void, sale returns
- **Customer & Supplier Credit** — Credit accounts, payment recording,
  outstanding balance tracking, statement view
- **Expenses** — Expense tracking with categories, void capability
- **Reporting** — Sales, financial, credit, expense reports with date range
  filtering
- **Notifications** — Per-user notification inbox with bell polling
- **Business Settings** — Configurable business name, address, tax rate,
  currency, contact info
- **Audit Trail** — 77 action codes covering all mutations

## Project Structure

```
.
├── client/                  # React + TypeScript + Vite + Tailwind CSS
│   └── src/
│       ├── auth/            # AuthContext, ProtectedRoute
│       ├── components/      # reusable UI + layout components
│       ├── config/          # client environment configuration
│       ├── lib/             # API client, utilities
│       ├── pages/           # all application pages (31 routes)
│       ├── routes/          # router definition
│       └── types/           # shared API types
├── server/                  # Node.js + Express + TypeScript + Prisma
│   ├── prisma/
│   │   ├── schema.prisma    # 37 models, 29 enums, 51 CHECK constraints
│   │   └── migrations/      # 10 migrations
│   └── src/
│       ├── config/          # env validation (zod)
│       ├── constants/       # audit actions, enums
│       ├── controllers/     # thin HTTP layer (19 controllers)
│       ├── lib/             # prisma client, logger
│       ├── middleware/      # auth, CSRF, rate limit, error handler
│       ├── routes/          # API route mounting (21 route groups)
│       ├── services/        # business logic (21 services)
│       ├── types/           # request context, shared types
│       └── utils/           # async handler, validators, document numbers
├── docs/                    # architecture, ERD, stage reports
├── scripts/                 # dev orchestration
└── package.json             # root convenience commands
```

## Requirements

- Node.js >= 20.19
- PostgreSQL 14+

## Setup

### 1. Install dependencies

```bash
npm install --prefix server
npm install --prefix client
```

### 2. Configure environment

Each package reads its own `.env` file.

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env`:

- `DATABASE_URL` — point it at a real PostgreSQL database.
- `JWT_SECRET` — generate a unique value: `openssl rand -hex 64`.
  In production this MUST NOT be a placeholder.

### 3. Initialize the database

```bash
npm run prisma:generate          # generate the Prisma client
npm run prisma:migrate           # create the database and apply migrations (dev)
# or apply existing migrations to an existing database without prompting:
npm run prisma:migrate:deploy
npm run db:seed                  # seed admin + assistant accounts
```

`prisma:migrate` uses your `DATABASE_URL` from `server/.env`.

> **Passwords are never reset by re-seeding.** The seed only creates the default
> accounts when they are missing and preserves any password you change in the app.
> If you forget a password, reset it with:
> `SEED_RESET_PASSWORDS=1 npm run db:seed`

### Default accounts (dev seed)

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@jmspareparts.local | Makire123 |
| ASSISTANT | assistant@jmspareparts.local | Shop12345 |

## Running

### Development (both processes)

```bash
npm run dev
```

- API: http://localhost:4000
- Web: http://localhost:5173

### Development (individually)

```bash
npm --prefix server run dev
npm --prefix client run dev
```

### Health check

```bash
curl http://localhost:4000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "makire-motorparts-api",
  "database": "up",
  "timestamp": "2026-08-25T00:00:00.000Z",
  "uptime": 12.34
}
```

If the database is not reachable, the API still starts and reports
`"database": "down"` so the degraded state is visible to monitoring.

### Production build

```bash
npm run build          # type-checks and builds server + client
npm start              # starts the compiled server (NODE_ENV=production)
```

### Quality checks

```bash
npm run typecheck
npm run lint
npm run test           # 169 unit tests
npm run test:integration  # 49 integration tests (requires PostgreSQL)
```

### Prisma / database tooling

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:deploy
npm run prisma:studio
```

## Environment Variables

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | dev | `development` \| `test` \| `production` |
| `PORT` | dev | API port (default `4000`) |
| `CLIENT_ORIGIN` | dev | Frontend origin allowed by CORS (alias `CLIENT_URL` also accepted) |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Minimum 32 chars; unique random value in production |
| `JWT_EXPIRES_IN` | dev | Access token lifetime (default `8h`) |

Invalid configuration fails fast with a clear message on startup. Production
fails safely if secrets are missing or placeholder values are detected.

### Client (`client/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | dev | Backend API base URL (default `/api`) |

## Security

- **Helmet** — hardened security headers
- **CORS** — restricted to `CLIENT_ORIGIN`, credentials enabled
- **Rate limiting** — global 300 req/min, login 10/15 min per IP
- **CSRF** — double-submit cookie on all state-changing routes
- **Authentication** — httpOnly + Secure + SameSite cookies, bcrypt password hashing (cost 12), JWT tokens
- **RBAC** — admin/assistant roles enforced server-side on all routes
- **Input validation** — Zod schemas on all endpoints
- **Error handling** — no stack traces, DB errors, or secrets in responses
- **Audit logging** — 77 action codes covering all business mutations
- **Database integrity** — 51 CHECK constraints, 58 foreign keys, FOR UPDATE locks on all financial mutations
- **Request timeout** — 30s per-request, 15s headers (slow-loris protection)
- **Production guards** — hard-fail on placeholder JWT_SECRET or HTTP origin

## Database

- **37 models** covering auth, catalog, inventory, purchasing, sales, credit,
  expenses, reports, notifications, settings
- **51 CHECK constraints** enforcing financial non-negativity, inventory
  non-negativity, quantity positivity, credit limits, and purchase integrity
- **10 migrations** — no schema drift
- **107 non-PK indexes** for query performance

See `docs/erd.md` for the entity-relationship diagram.

## Architecture

See `docs/architecture.md` for the full system architecture including
deployment architecture (Nginx + PM2 + PostgreSQL), backup strategy,
and monitoring recommendations.

## Development Notes

- Requests carry a request ID (`X-Request-Id` header) generated by the
  server and propagated to logs and error responses
- Environment validation fails fast using Zod (see `server/src/config/env.ts`)
- All IDs use Prisma `cuid()`
- Money is stored as `Decimal` — never floats
- Document numbers are generated atomically via `UPDATE ... SET lastNumber = lastNumber + 1`

## License

Proprietary. Not licensed for redistribution.
