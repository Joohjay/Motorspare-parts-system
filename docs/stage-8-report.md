# Stage 8 Report — Purchase Returns, Receipts, Dashboard, Notifications & Settings

**Project:** JM SPAREPARTS (formerly MAKIRE MOTORPARTS)
**Stage:** 8 of 8 — final stage
**Date:** 2026-08-24
**Status:** Complete — all verification green; live UI smoke PENDING (manual)

---

## 1. Scope

Stage 8 hardens day-to-day operations and closes the deferred Stage 7 items:

- **Purchase returns** — ADMIN-processed returns of accepted goods back to a
  supplier, with per-line returnable caps, weighted-average inventory
  deduction, supplier settlement (credit-balance reduction / cash refund /
  deferred), full reversal via cancel, and audit coverage.
- **Receipts & printing** — `GET /api/sales/:id/receipt` plus a print-ready
  receipt page; business details come from settings; printing hides the app
  shell so only the paper receipt prints. A sale's number doubles as the
  receipt number.
- **Management dashboard** — one aggregated, role-aware endpoint: today's
  sales/revenue/average sale, payment mix, low/out-of-stock alerts, top
  sellers this month, recent sales & purchases, customer credit exposure,
  supplier credit outstanding, open purchase orders — and, for the ADMIN only,
  COGS / gross profit / expenses / net profit for today.
- **Notifications** — per-user inbox (list, unread count, mark read, mark all
  read) over the existing notification rows created idempotently by
  InventoryService on stock movements; bell with badge in the layout plus a
  full notifications page.
- **Business settings** — whitelisted business profile (name, address, phone,
  email, currency, timezone, receipt footer) readable by any authenticated
  user, updatable by ADMIN only, audited.
- **Login theme** — split-screen sign-in with inline-SVG motorcycle artwork
  (offline-safe), JM SPAREPARTS branding, subtitle "Motorcycle Spare Parts
  Management System".
- **UI/UX polish** — new navigation entries (Purchase returns, Business
  settings, Notifications bell), dashboard quick actions permission-filtered,
  consistent empty/loading/error states in all new screens.

Out of scope (unchanged from spec): barcode/label printing, exports beyond
existing CSV, multi-location anything.

## 2. Schema changes & migration

One additive migration:

- `server/prisma/migrations/202608210003_stage8_purchase_returns/`

| Change | Detail |
| --- | --- |
| `purchase_returns.creditedAmount` | `numeric(12,2) NOT NULL DEFAULT 0` — portion settled against the supplier credit account (clamped at outstanding balance) |
| `purchase_returns.refundMethod` | `"PaymentMethod" NULL` — refund channel (`REFUND` settlement only) |
| `purchase_returns.refundReference` | `text NULL` — transaction/provider reference |
| `document_sequences` row | `PURCHASE_RETURN`, prefix `PURCHASE_RETURN`, padLength 6 |

No other tables changed — `Notification` and `Setting` were modelled in
Stage 2 and only gained their API surface now.

## 3. Document numbering

`PURCHASE_RETURN` joins the existing atomic numbering scheme: consumed inside
the return's own transaction via `UPDATE … RETURNING`; failed transactions do
not burn numbers (verified by test).

## 4. Services

New server modules:

- **purchaseReturnService.ts**
  - `createPurchaseReturn(purchaseId, body, ctx)` — one transaction:
    lock purchase row → status/line ownership checks → cumulative returnable
    caps → document number → header + items at frozen costs →
    `decreaseStockTx(type='PURCHASE_RETURN')` per line (current WAC, ledger
    row, idempotent low-stock notifications) → settlement:
    `SUPPLIER_CREDIT` reduces the credit account under `FOR UPDATE`,
    clamped at zero, remainder reported as `refundDue`; `REFUND` records
    method/reference; `NONE` defers. Audits after commit
    (`PURCHASE_RETURN_CREATED`, plus `SUPPLIER_REFUND_RECORDED` when a refund
    is captured).
  - `cancelPurchaseReturn(id, ctx)` — ADMIN corrective reversal: restock at
    frozen cost (`ADJUSTMENT` referencing the return), re-charge credited
    amount capped by available headroom (balances never go negative),
    report `creditRestored` / `creditUnrecoverable`. Rejects double-cancel
    (`PURCHASE_RETURN_NOT_ACTIVE`).
  - `getPurchaseReturn` / `listPurchaseReturns` — detail includes per-item
    frozen cost and computed `refundDue = total − credited`.
- **dashboardService.ts** — single aggregated query fan-out reusing
  reportsService functions verbatim (single source of truth). ASSISTANT gets
  an early-return shape without any financial block.
- **notificationService.ts** — strictly per-user list/unread-count/mark-read/
  mark-all-read; foreign notification IDs 404.
- **settingsService.ts** — whitelist of public keys with defaults;
  `updateSettings` diffs before/after, upserts changes, audits
  `SETTINGS_UPDATED`.

## 5. API surface

| Method & path | Access | Purpose |
| --- | --- | --- |
| `POST /api/purchases/:id/returns` | ADMIN | Create completed purchase return |
| `GET /api/purchase-returns` | both roles | Paginated list (q/status/purchase/supplier filters) |
| `GET /api/purchase-returns/:id` | both roles | Full detail incl. items + settlement |
| `POST /api/purchase-returns/:id/cancel` | ADMIN | Reverse a completed return |
| `GET /api/sales/:id/receipt` | both roles | Role-safe sale snapshot + business info (+customer credit balance) |
| `GET /api/dashboard` | both roles | Role-aware aggregated dashboard |
| `GET /api/settings` | both roles | Whitelisted business settings |
| `PUT /api/settings` | ADMIN | Update settings (audited) |
| `GET /api/notifications` | self | Own notifications (`unreadOnly` supported) |
| `GET /api/notifications/unread-count` | self | Badge count |
| `POST /api/notifications/:id/read` | self only | Mark one read (foreign IDs 404) |
| `POST /api/notifications/mark-all-read` | self | Mark all read |

## 6. Validation & error codes

New zod schemas: `purchaseReturnCreateSchema` (1–100 lines, positive integer
quantities, reason ≥ 3 chars, settlement enum, conditional
`refundMethod`/`refundReference` cross-field rules),
`purchaseReturnListQuery`, settings update record (whitelist + non-empty),
notification list params.

New error codes: `RETURN_EXCEEDS_RETURNABLE`, `INVALID_PURCHASE_ITEM`,
`PURCHASE_NOT_ACTIVE`, `PURCHASE_RETURN_NOT_ACTIVE`,
`SUPPLIER_CREDIT_NOT_FOUND`, `SUPPLIER_CREDIT_NOT_ACTIVE` (reused semantics).

## 7. Concurrency & atomicity (verified vs real PostgreSQL)

Integration tests prove:

- Five concurrent 3-unit returns against a 10-unit line → exactly 3 succeed,
  2 fail with `RETURN_EXCEEDS_RETURNABLE`; on-hand ends at 1.
- Four concurrent 75-credit returns against an 80 balance → every success
  clamps to what remained when its lock fired; final balance exactly 0;
  never negative.
- Over-returns roll back completely — no header, no ledger rows, no burned
  document number.

## 8. Frontend

- **pages/DashboardPage.tsx** — real dashboard replacing the Stage 4
  placeholder: stat cards, payment mix, low-stock alerts, top sellers, recent
  sales/purchases, top debtors, quick actions (permission-filtered).
- **pages/sales/ReceiptPage.tsx** — thermal-style receipt (business header,
  frozen line items, payments, credit balance, voided banner, footer message)
  with `window.print()`; app shell hidden via `print:hidden`.
- **components/layout/NotificationBell.tsx** — polling bell (~60 s), dropdown
  preview, mark-read/mark-all-read; unread conveyed by dot AND bold text.
- **pages/notifications/NotificationsPage.tsx**, filter toggle, type labels.
- **pages/settings/SettingsPage.tsx** — read-only for ASSISTANT, editable for
  ADMIN with change-diff save.
- **pages/purchasing/PurchaseReturnModal.tsx** — quantity-capped inputs,
  estimated total at frozen costs, settlement chooser with conditional refund
  fields; launched from the receiving detail modal.
- **pages/purchasing/PurchaseReturnsPage.tsx** — searchable list, status
  pills, detail modal with ADMIN cancel-and-restock action.
- **pages/LoginPage.tsx** — split-screen brand panel with inline SVG
  motorcycle art; form logic unchanged.
- **lib/stage8Api.ts** + types — typed clients for everything above.

Navigation additions: Purchasing → "Purchase returns", Admin → "Business
settings", notification bell in sidebar footer and mobile bar.

## 9. Security review (PASS)

- **Authorization matrix**: create/cancel purchase return and update settings
  are `requireAdmin` at the router; list/get/dashboard/receipt are
  authenticated with role-aware payloads assembled server-side; notification
  routes always scope by the token-derived user ID, never client input.
- **Financial data isolation**: the ASSISTANT dashboard branch omits COGS /
  gross profit / expenses / net entirely; the receipt endpoint reuses the
  role-stripped sale projection, so no cost figures can leak via composition.
- **Settings endpoint**: strict key whitelist — unknown or protected keys are
  rejected; secrets/config never live in this table.
- **Input validation**: all new endpoints validate at the boundary (zod);
  quantities are coerced positive integers; string lengths bounded.
- **Audit trail**: `PURCHASE_RETURN_CREATED`, `SUPPLIER_REFUND_RECORDED`,
  `PURCHASE_RETURN_CANCELLED` (with restored/unrecoverable amounts) and
  `SETTINGS_UPDATED` (changed keys with before/after) all recorded after
  commit.
- No secrets in code/logs; `.env` remains git-ignored; cookies remain
  httpOnly + CSRF-protected (all mutations verified through CSRF in tests).

## 10. Financial & inventory integrity review (PASS)

- Every mutation is a single DB transaction; document numbers participate in
  it (no burn on failure).
- Stock decreases at current WAC; WAC is unchanged by decreases; cancellation
  restores at frozen cost and recomputes WAC correctly (verified numerically).
- Supplier balances are modified only under `FOR UPDATE`, only by
  clamp-limited deltas; CHECK constraints and service logic together make
  negative balances impossible.
- Returnable caps are enforced cumulatively across documents under the
  purchase row lock.
- Cancel is the only path that mutates a completed return, and it is itself
  idempotent-guarded (double cancel rejected).
- Money arithmetic uses Prisma Decimal end-to-end; JSON boundaries serialize
  to fixed 2-dp strings.

## 11. Testing strategy & verification results

| Suite | Result |
| --- | --- |
| Server unit tests (`npm test`) — includes 11 new purchase-return scenarios (creation, clamping, rollback, refunds, authz, cancel/reversal) | **169/169 PASS** |
| Server integration tests (`npm run test:integration`) — includes 6 new real-PostgreSQL suites (costing vs settlement, credit clamp, cancel restore + headroom cap, concurrent returns, concurrent credit race, sequence preservation) | **49/49 PASS** |
| `tsc --noEmit` server / client | PASS / PASS |
| ESLint server / client | PASS / PASS |
| Client production build (`vite build`) | PASS |
| `prisma validate` / `migrate status` | Valid / up to date (10 migrations) |

## 12. Known limitations / deferred

- Live browser smoke test of printing and dashboard visuals is PENDING
  (manual) — the user runs dev servers themselves.
- Notifications currently originate from inventory thresholds (the events the
  domain emits); credit-due and reservation-pending enum values exist but have
  no producer yet — the inbox renders any future types generically.
- Receipt printing relies on the browser's print dialog (no silent/thermal
  ESC-POS driver).
- Brand-name note: the original Stage 8 brief mentioned "MAKIRE MOTORARTS"
  wording; the project was explicitly rebranded to **JM SPAREPARTS** earlier,
  so JM SPAREPARTS branding is used throughout (login subtitle carries the
  requested "Motorcycle Spare Parts Management System" line).

## 13. Handover notes

- Apply migrations with `npx prisma migrate deploy` (dev DB and test DB are
  both already up to date).
- Seed data unchanged: `npm run db:seed`
  (`admin@jmspareparts.local` / `Makire123`,
  `assistant@jmspareparts.local` / `Shop12345`).
- Run everything locally: server `npm run dev` (:4000), client `npm run dev`
  (:5173); tests as in §11.
- Docs updated: `docs/architecture.md` (Stage 8 section),
  `docs/erd.md` (settlement columns + sequence row).
EOF
wc -l stage-8-report.md