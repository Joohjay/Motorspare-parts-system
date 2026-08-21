# MAKIRE MOTORPARTS

Professional motorcycle spare parts management system.

A production-quality application for managing motorcycle spare parts, product
catalog, suppliers, purchasing, receiving, inventory, retail and wholesale
sales, discounts, payments, customer and supplier credit, returns, expenses,
reporting, notifications and audit history.

## Status

**Stage 1 — Technical foundation.** The application shell is in place and
verified: frontend and backend start and build, environment validation works,
Prisma is configured for PostgreSQL, the `/api/health` endpoint works, central
error handling, structured logging, security headers, CORS, rate limiting and
the CSRF foundation are functional.

**Business modules (products, inventory, sales, purchasing, credit, reports,
etc.) are intentionally NOT implemented yet.** They will be added in later
stages.

## Project structure

```
.
├── client/                  # React + TypeScript + Vite + Tailwind CSS
│   ├── public/
│   └── src/
│       ├── components/      # reusable UI + layout components
│       ├── config/          # client environment configuration
│       ├── lib/             # API client
│       ├── pages/           # Home, Login placeholder, 404
│       ├── routes/          # router definition
│       └── types/           # shared API types
├── server/                  # Node.js + Express + TypeScript + Prisma
│   ├── prisma/
│   │   ├── schema.prisma    # minimal Stage 1 schema (User only)
│   │   └── migrations/      # initial migration
│   └── src/
│       ├── config/          # env validation (zod)
│       ├── controllers/     # thin HTTP layer
│       ├── lib/             # prisma client, logger
│       ├── middleware/      # error, logging, rate limit, CSRF
│       ├── routes/          # API route mounting
│       └── utils/           # async handler
├── docs/                    # design / architecture notes
├── scripts/                 # dev orchestration
├── package.json             # root convenience commands
├── .env.example
├── .editorconfig
└── .gitignore
```

## Requirements

- Node.js >= 20.19
- PostgreSQL 14+ (local or hosted)

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
```

`prisma:migrate` uses your `DATABASE_URL` from `server/.env`.

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
  "timestamp": "2026-08-20T00:00:00.000Z",
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
```

### Prisma / database tooling

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:deploy
npm run prisma:studio
```

## Environment variables

### Server (`server/.env`)

| Variable         | Required | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `NODE_ENV`       | dev      | `development` \| `test` \| `production`                            |
| `PORT`           | dev      | API port (default `4000`)                                          |
| `CLIENT_ORIGIN`  | dev      | Frontend origin allowed by CORS (alias `CLIENT_URL` also accepted) |
| `DATABASE_URL`   | yes      | PostgreSQL connection string                                       |
| `JWT_SECRET`     | yes      | Minimum 32 chars; unique random value in production                |
| `JWT_EXPIRES_IN` | dev      | Access token lifetime (default `8h`)                               |

Invalid configuration fails fast with a clear message on startup. Production
fails safely if secrets are missing or placeholder values are detected.

### Client (`client/.env`)

| Variable        | Required | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `VITE_API_URL`  | dev      | Backend API base URL (default `/api`)    |

## Security foundation (Stage 1)

- **Helmet** — hardened security headers.
- **CORS** — restricted to `CLIENT_ORIGIN`, credentials enabled.
- **Rate limiting** — global `/api` limiter (300 req/min per IP).
- **CSRF** — double-submit cookie middleware. State-changing requests must
  echo the CSRF cookie value in the `X-CSRF-Token` header. In Stage 1 there are
  no state-changing endpoints yet; Stage 3 will add the token endpoint and
  exempt the auth endpoints. Requests that fail the CSRF check return `403
  CSRF_TOKEN_INVALID`.
- **Request size limit** — JSON bodies limited to 1 MB.
- **Secure error responses** — no stack traces, environment variables, or
  database credentials are leaked to clients; raw Prisma/database errors are
  mapped to safe responses.
- **Structured logging** — timestamped, leveled, request-ID aware; secrets are
  never logged.

## Development notes

- Requests carry a request ID (`X-Request-Id` header) generated by the
  server and propagated to logs and error responses.
- Environment validation fails fast using zod (see
  `server/src/config/env.ts`).
- All IDs use Prisma `cuid()`. Money will be stored as `Decimal` in later
  stages — never floats.

## License

Proprietary. Not licensed for redistribution.