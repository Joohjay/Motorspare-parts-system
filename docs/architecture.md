# MAKIRE MOTORPARTS — Architecture & Design Notes

Design documentation for the motorcycle spare parts management system.

## Stage 1 — completed

Technical foundation only: repo scaffolding, frontend/backend shells,
PostgreSQL connection via Prisma, offline initial migration, environment
validation, health check, central error handling, structured logging, security
middleware (Helmet, CORS, rate limiting, CSRF foundation), and branding.

## Stage 2 — completed

Database and entity architecture for the full approved business scope. The
complete Prisma schema, initial migration, seed script, and ERD documentation
are implemented. See `docs/erd.md` for the ERD.

### Stage 2 scope notes

- Data layer only: schema, Prisma Client, offline migration, seed, and
  documentation. No controllers/services/API endpoints or business UI.
- The Stage 2 migration is generated offline with `prisma migrate diff` and is
  ready to apply; live application is pending a running PostgreSQL instance.
- Two dev users are seedable (`npm run db:seed`): one ADMIN, one ASSISTANT,
  plus minimal settings and document sequences. Passwords are hashed with
  `bcryptjs` (bcrypt, `$2b$`, pure-JS — no native build step); override with
  `SEED_ADMIN_PASSWORD` / `SEED_ASSISTANT_PASSWORD`. Never use in production.

## Stage 3 — completed

Authentication, session security, and admin/assistant authorization.

### Sessions

- Login issues a signed JWT (HS256) stored in an **httpOnly** cookie
  (`makire_session`, SameSite=Lax, Path=/, Secure in production). Tokens are
  never readable from JavaScript and never stored in localStorage.
- `requireAuth` verifies the JWT and then **re-reads the user from the
  database on every request**, so role/status changes (e.g. an admin
  deactivating someone) take effect immediately — the client's claimed role is
  never trusted. `requireAdmin` enforces the `ADMIN` role server-side.
- Deactivated accounts cannot act: authenticated requests from an `INACTIVE`
  account return `403 ACCOUNT_INACTIVE`, while logins with an inactive account
  return the same `401 INVALID_CREDENTIALS` as any other failed login (no user
  enumeration). Timing is equalized with a dummy bcrypt compare when the email
  is unknown.

### Password security

- Passwords are bcrypt (`bcryptjs`, cost 12 default) and the policy requires
  ≥ 12 characters with a letter and a number, no email-prefix substring, and no
  long repetitive runs — enforced on both set-password paths (seed/creation and
  reset).
- Password reset: `crypto.randomBytes(32)` token shown once to the user; the
  database stores only its SHA-256 hash in `password_reset_tokens` with an
  expiry (1h) and a `usedAt` flag. Tokens are single-use and all outstanding
  tokens for a user are invalidated on a successful reset. The forgot-password
  response is identical whether or not the account exists (no enumeration);
  the reset link is only logged in development.
- `PATCH /api/auth/users/:id/status` (ADMIN only) activates/deactivates
  accounts. Deactivating yourself is rejected (`CANNOT_DEACTIVATE_SELF`) and
  deactivating the last active ADMIN is rejected (`FINAL_ADMIN_PROTECTION`).

### CSRF & rate limiting

- Double-submit CSRF cookie (`makire_csrf`, non-httpOnly). `GET
  /api/auth/csrf` returns the token; the client echoes it in `X-CSRF-Token` on
  every state-changing request. The exemption list remains empty (nothing
  state-changing bypasses CSRF).
- Login has a dedicated failure limiter (default 10 failures / 15 min,
  counting only failures) in addition to the global `/api` limiter.

### Audit events

`AuditLog` rows are written best-effort (never fail the request) for:
LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_RESET_REQUESTED,
PASSWORD_RESET_COMPLETED, ACCOUNT_ACTIVATED, ACCOUNT_DEACTIVATED.
(PASSWORD_CHANGED is reserved for a future change-password feature.)

### Frontend auth foundation

- `AuthContext` restores the session on load (`/api/auth/me`), exposes
  login/logout, and drives a loading/authenticated/unauthenticated state.
- `ProtectedRoute`/`RequireAdmin` guard dashboard/admin routes (UX only — the
  backend remains authoritative). Login, forgot-password and reset-password
  pages are wired; `DashboardPage` is the authenticated landing shell.

### API surface (Stage 3)

`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST
/api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET
/api/auth/csrf`, `PATCH /api/auth/users/:id/status`. No business routes.

### Testing

`server/tests/auth.test.ts` runs the real Express app with an in-memory Prisma
mock (test seam `globalThis.__MAKIRE_PRISMA__`) and real bcrypt at reduced
cost — 25 tests covering login, logout, session restoration, role/status
enforcement, CSRF, rate limiting, password policy, reset flow (incl. single-use
and expiry), account status, and final-admin protection. Live-database
migration/integration verification is PENDING (no PostgreSQL available).

### Domain modules and entities

| Module | Entities |
|--------|----------|
| System | User, AuditLog, Notification, Setting, DocumentSequence |
| Catalog | Category, Brand, Product, ProductIdentifier |
| Motorcycle | MotorcycleMake, MotorcycleModel, MotorcycleVariant, ProductCompatibility |
| Suppliers | Supplier, SupplierProduct |
| Purchasing | PurchaseOrder, PurchaseOrderItem, Purchase, PurchaseItem, PurchaseReturn, PurchaseReturnItem |
| Inventory | Inventory, InventoryTransaction, StockReservation |
| Sales | Customer, Sale, SaleItem, Payment, SaleReturn, SaleReturnItem |
| Customer credit | CustomerCreditAccount, CustomerCreditPayment |
| Supplier credit | SupplierCreditAccount, SupplierCreditPayment |
| Finance | ExpenseCategory, Expense |

### Key design decisions

- **Enums over tables** for role, status, document type, payment method, etc.
  `PaymentMethod` is a fixed enum (CASH, MPESA, AIRTEL_MONEY, BANK, OTHER) — no
  method attributes table.
- **Identifiers.** Multiple searchable identifiers per product via
  `ProductIdentifier` with a unique `(type, value)` index (PART_NUMBER,
  OEM_NUMBER, ALTERNATIVE_NUMBER, SUPPLIER_NUMBER, OTHER). Per-supplier part
  numbers live on `SupplierProduct.supplierPartNumber`; the SUPPLIER_NUMBER
  identifier remains the canonical supplier-facing identifier for the product.
- **Ordering vs receiving are separate.** PurchaseOrder captures what was
  ordered; Purchase captures what was actually received, supporting partial
  receiving. Inventory increases only by `quantityAccepted`.
- **Inventory is a ledger.** `Inventory` holds the current state
  (quantityOnHand, quantityReserved, minStock, reorderLevel); every movement is
  an immutable `InventoryTransaction` row. Adjustments happen through journal
  entries, never by mutating the balance directly.
- **Credit accounts are derived, not source-of-truth.** Sales/purchases remain
  the source transactions; credit account balances are stored for query
  performance and kept in sync by services, with reconciliation possible
  against the summed transactions.
- **Frozen prices.** SaleItem/PurchaseItem capture unit prices/costs and line
  totals at transaction time, so later price changes never rewrite history.
- **Weighted-average cost** is the chosen costing method; it will be computed
  by business services (later stage) from PurchaseItem.unitCost and
  quantityAccepted. No premature cost-ledger table.
- **Walk-in sales allowed.** `Sale.customerId` is nullable; credit/wholesale
  customers are created on demand.
- **Concurrency-safe numbering.** `DocumentSequence` uses an atomic
  `UPDATE ... SET lastNumber = lastNumber + 1 ... RETURNING` pattern (implemented
  in a later stage) so invoices/POs never collide under concurrency.
- **No physical deletes for business records.** Transaction references use
  `ON DELETE RESTRICT`; soft deactivation via status enums. Optional links use
  `ON DELETE SET NULL` (e.g., Purchase.purchaseOrderId, createdBy on audit
  rows).
- **Money is always `Decimal`** (`numeric(12,2)` in Postgres) — never floats.

### Constraints and integrity

Prisma 6 cannot express `@@check` in the schema, so every data-integrity check
constraint is declared directly in the migration SQL:

- Non-negative prices, costs, amounts, balances, and stock levels.
- Positive quantities for items, returns, payments, expenses, and reservations.
- `quantityAccepted <= quantityReceived`;
  `quantityDamaged + quantityMissing <= quantityReceived`;
  `quantityReserved <= quantityOnHand`; inventory movements `<> 0`.
- `discount <= subtotal` on Sales.
- Credit accounts: `outstandingBalance <= creditLimit` when `creditLimit > 0`.
- Motorcycle variant model years: `yearFrom <= yearTo` when both are set.

## Design principles

- **Thin controllers, fat services.** HTTP concerns live in controllers and
  routes; business rules live in services; database access is centralized.
  (Stage 1 had no services because there was no business logic; Stage 3
  introduced services with the auth module.)
- **Validation at the API boundary.** zod schemas are applied when requests
  enter the API. (Stage 1 validated environment configuration with zod; auth
  routes added zod body validation in Stage 3.)
- **Fail closed by default.** Rate limiting, CSRF checks, and error handling
  fail closed rather than silently passing requests through.
- **No leaked internals.** Production responses never include stack traces,
  environment variables, database credentials, or internal paths. Raw
  Prisma/database errors are mapped to safe, categorized responses.
- **Structured logs.** Every log line is timestamped and leveled; request IDs
  correlate log lines to individual HTTP requests. Secrets are never logged.
- **Minimal now, extensible later.** The Stage 1 database schema contains only
  what the foundation needs (a minimal `User` model with `ADMIN`/`ASSISTANT`
  role enum). Business entities arrive with Stage 2.

## Approved scope constraints

- Two roles only: `ADMIN`, `ASSISTANT` (role enum on the `User` model — no
  data-driven role/permission/branch tables).
- One physical location, one administrator, one assistant. No branches, no
  multi-branch architecture, no loans, no payroll, no general ledger.
- Separate application from the automotive reference project: separate
  database, schema, migrations, environment, process, and deployment. It never
  depends on the automotive database.

## Stage 1 entities

| Entity | Purpose |
|--------|---------|
| `User` | Minimal staff account foundation (id, email, full name, password hash, role, status). |

`Role`/`Permission`/`RolePermission` tables from the automotive reference are
intentionally NOT used. Authorization is explicit at the service/API layer
using the `ADMIN`/`ASSISTANT` role enum (implemented in Stage 3).

## Request flow (Stage 1)

```
Request
  -> Helmet, CORS, JSON body parser, cookie parser
  -> request ID generation (X-Request-Id)
  -> request logging
  -> CSRF protection (state-changing methods)
  -> /api rate limiter
  -> auth routes: requireAuth / requireAdmin (where applicable)
  -> routes -> controllers -> services -> Prisma -> PostgreSQL
  -> not-found handler -> central error handler
Response
```

## Security notes

- CSRF: double-submit cookie. `GET /api/auth/csrf` returns the token and the
  client echoes it in the `X-CSRF-Token` header on state-changing requests
  (wired in Stage 3). The exemption list is empty.
- Rate limiting: `express-rate-limit`, IP-keyed, 300 requests/minute on `/api`
  plus a login-specific failure limiter (default 10 failures / 15 min),
  configurable in `server/src/middleware/rateLimit.ts` and
  `server/src/config/env.ts`.
- Production startup fails if `JWT_SECRET` is a placeholder or `CLIENT_ORIGIN`
  is not HTTPS.