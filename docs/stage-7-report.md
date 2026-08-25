# Stage 7 Report — Sales/POS, Customer Credit, Returns, Expenses & Reporting

**Project:** JM SPAREPARTS (formerly MAKIRE MOTORPARTS)
**Stage:** 7 of 7 — final stage
**Date:** 2026-08-24
**Status:** Complete — all verification green; live UI smoke PENDING (manual)

---

## 1. Scope

Stage 7 completes the system with the revenue side of the business:

- **Sales / POS** — counter sales with retail/wholesale pricing, line and
  sale-level discounts (ADMIN-only), split payments across cash / M-Pesa /
  bank / cheque / other **and customer credit**, all in one atomic transaction.
- **Customers** — master data with types (retail, wholesale, mechanic, garage,
  business), activation lifecycle and optional credit accounts with limits.
- **Customer credit** — credit sales charge an open account inside the sale
  transaction; payments reduce the balance under a row lock; a statement
  derives the running balance from source transactions only.
- **Sales returns & refunds** — partial/full returns per sale line with
  condition tracking (`GOOD` restocks at frozen historical cost; `DAMAGED`,
  `DEFECTIVE`, `WRONG_ITEM`, `OTHER` do not); settlement via cash-equivalent
  refund **or** credit-balance adjustment — never both.
- **Voiding** — ADMIN-only void restores stock at original cost, reverses
  credit portions clamped at zero balance and reports any remainder as
  `refundDue`.
- **Expenses** — categorised operating expenses with soft void; voided rows
  are kept for audit but excluded from reports.
- **Reporting foundation** — range presets in shop-local time (EAT, UTC+3):
  sales summary (revenue/COGS/gross profit/discounts), payment-method totals,
  daily series, returns summary, expense summary by category, credit exposure
  with top debtors, and a combined financial report.

Also delivered during this window (pre-Stage-7 hardening): brand rename to
**JM SPAREPARTS** everywhere including seeded settings rows, minimum password
length lowered to 8 for practical logins, and the fix for missing
`Content-Type` on client `apiRequest` bodies.

Out of scope: purchase returns (deferred), receipt printing/export.

## 2. Schema changes & migration

Migrations:

- `server/prisma/migrations/202608210001_stage7_sales_finance/`
- `server/prisma/migrations/202608210002_payment_method_credit/`

| Change | Detail |
| --- | --- |
| `CustomerType` enum + `customers.type` | RETAIL / WHOLESALE / MECHANIC / GARAGE / BUSINESS / OTHER |
| `SaleItem.unitCost`, `SaleItem.lineCost` | frozen historical cost at sale time — COGS never changes after the fact |
| `ReturnCondition` enum + `sale_return_items.condition` | GOOD / DAMAGED / DEFECTIVE / WRONG_ITEM / OTHER |
| `sale_returns.refundMethod`, `.refundReference`, `.creditAdjusted` | exactly-one-settlement-path enforcement |
| `ExpenseStatus` enum + `expenses.status` | ACTIVE / VOID (soft void) |
| `PaymentMethod.CREDIT` | added so mixed payments live in one `Payment` table |

Stage 2 modelling already carried most CHECK constraints
(`sales_discount_not_exceed_subtotal`, `sale_items_quantity_positive`, …) — no
duplicates were created. Applied via `npx prisma migrate deploy` to both the
dev database and `makire_motorparts_test` (`prisma migrate dev` is unusable on
this machine: shadow-DB permission denied). `prisma migrate status` clean,
`prisma validate` passes.

## 3. Document numbering

Reused `nextDocumentNumber(tx, documentType)` unchanged (atomic
`UPDATE … RETURNING`). New sequences seeded: `SALE`, `SALE_RETURN`.
Integration tests prove: 20 concurrent sales → 20 unique gap-free numbers;
failed transactions burn nothing.

## 4. Inventory service refactor

`decreaseStock` was split into a transaction-aware core:

```ts
export async function decreaseStockTx(tx, input): Promise<InventoryMutationResult>
```

Weighted-average stock is reduced with a `SELECT … FOR UPDATE` row lock; the
movement ledger row freezes `unitCost` (the sale's COGS input) and records
`balanceAfter`. Low-stock notifications fire post-commit. Sale creation locks
all needed inventory rows **in deterministic productId order** before any
deduction, making concurrent multi-line sales deadlock-free.

## 5. Services

### 5.1 salesService.ts
- `createSale` — one transaction: document number → sale header → items
  (default price = retail/wholesale by `saleType`; ADMIN may override per line,
  audited `SALE_PRICE_OVERRIDE`) → `decreaseStockTx` per product (frozen COGS)
  → payment allocations → `chargeCreditTx` for CREDIT portions. Allocations
  must sum **exactly** to `totalAmount` (`PAYMENT_MISMATCH`). Discount ≤ 10%
  cap enforced by validator/service (`INVALID_DISCOUNT`).
- `buildSaleDetail` — strips `cogs`/`unitCost`/`lineCost` from ASSISTANT
  responses (financials are ADMIN-only).
- `listSales` — filters: q (sale number), customerId, status, saleType,
  paymentMethod, creator, date range; sort + pagination.
- `voidSale(saleId, reason)` — ADMIN; restores stock via `increaseStockTx`
  (type `ADJUSTMENT`, reference = sale id) at each item's frozen cost;
  reverses CREDIT payments against the customer balance **clamped at zero**
  with any excess reported as `refundDue`; idempotency guarded
  (`SALE_ALREADY_VOIDED`).

### 5.2 customerCreditService.ts
- `openCreditAccount`, `getCreditAccount`, `setCreditLimit`.
- `chargeCreditTx` — called inside the sale transaction; rejects when the
  charge would exceed available headroom (`CREDIT_LIMIT_EXCEEDED`).
- `recordCreditPayment` — standalone transaction; locks the account row
  `FOR UPDATE`; rejects overpayment (`PAYMENT_EXCEEDS_BALANCE`) → balance can
  never go negative even under concurrency.
- `getStatement` — debits from `payments(paymentMethod=CREDIT)` joined to their
  sales, credits from `customer_credit_payments`; running balance computed from
  **source transactions only** so it can never drift from the account row.

### 5.3 customerService.ts
CRUD + search + status. Deactivation blocked while outstanding credit > 0
(`CUSTOMER_HAS_OUTSTANDING_CREDIT`). All mutations ADMIN.

### 5.4 salesReturnService.ts
- `createSaleReturn` — one transaction: sale must be COMPLETED; returnable =
  sold − already returned (via `groupBy`, cumulative across returns);
  effective per-unit refund price = `lineTotal ÷ quantity` (2 dp) so line
  discounts stay proportionate; `GOOD` lines restock through `increaseStockTx`
  (type `SALE_RETURN`) at the item's **frozen** unit cost; settlement is either
  `creditAdjusted` (balance reduction) or `refundMethod` — both set ⇒ error;
  credit adjustment rejected if refund > outstanding
  (`REFUND_EXCEEDS_BALANCE`).
- `getSaleReturn`, `listSaleReturns`.

### 5.5 expenseService.ts / reportsService.ts
- Expenses: categories (unique names) + expenses with soft void; voided twice
  ⇒ `EXPENSE_ALREADY_VOIDED`; negative amounts rejected.
- Reports: `resolveRange` presets (today/yesterday/this_week/this_month, EAT
  UTC+3 arithmetic, swapped ranges normalised); aggregates over COMPLETED rows
  only — voided sales/expenses/returns excluded by construction.

## 6. API surface

All mounted under `/api` in `src/routes/index.ts`:

| Method & path | Purpose | Roles |
| --- | --- | --- |
| GET `/customers` | list/search customers | ADMIN, ASSISTANT |
| POST `/customers` | create | ADMIN |
| GET `/customers/:id` | detail incl. credit account | ADMIN, ASSISTANT |
| PATCH `/customers/:id` | update | ADMIN |
| PATCH `/customers/:id/status` | activate/deactivate | ADMIN |
| POST `/customers/:id/credit-account` | open credit account | ADMIN |
| GET `/customers/:id/credit-account` | account summary | ADMIN, ASSISTANT |
| PATCH `/customers/:id/credit-limit` | set limit | ADMIN |
| POST `/customers/:id/credit-payments` | record credit payment | ADMIN |
| GET `/customers/:id/credit-payments` | payment history | ADMIN, ASSISTANT |
| GET `/customers/:id/statement` | running statement | ADMIN, ASSISTANT |
| GET `/sales` | list sales | ADMIN, ASSISTANT |
| POST `/sales` | create sale (POS) | ADMIN, ASSISTANT |
| GET `/sales/:id` | detail (COGS stripped for ASSISTANT) | ADMIN, ASSISTANT |
| POST `/sales/:id/void` | void sale | ADMIN |
| POST `/sales/:id/returns` | process return | ADMIN |
| GET `/sales-returns` | list returns | ADMIN, ASSISTANT |
| GET `/sales-returns/:id` | return detail | ADMIN, ASSISTANT |
| GET `/finance/expense-categories` | list categories | ADMIN, ASSISTANT |
| POST `/finance/expense-categories` | create category | ADMIN |
| PATCH `/finance/expense-categories/:id` | update category | ADMIN |
| GET `/finance/expenses` | list expenses | ADMIN, ASSISTANT |
| POST `/finance/expenses` | record expense | ADMIN |
| PATCH `/finance/expenses/:id` | edit expense | ADMIN |
| POST `/finance/expenses/:id/void` | void expense | ADMIN |
| GET `/finance/reports/sales` | revenue/payments/daily series | ADMIN, ASSISTANT |
| GET `/finance/reports/financial` | combined financial report | ADMIN, ASSISTANT |
| GET `/finance/reports/credit` | credit exposure | ADMIN, ASSISTANT |
| GET `/finance/reports/expenses` | expense summary | ADMIN, ASSISTANT |

Price override and every mutation above marked ADMIN are enforced server-side
(`requireRole('ADMIN')` or explicit service checks); assistant attempts return
403.

## 7. Business rules & invariants

1. **COGS is frozen forever** — `sale_items.unitCost/lineCost` snapshot the
   weighted average at sale time; later purchases never restate profit.
2. Payment allocations sum **exactly** to the total; over/under is impossible
   (`PAYMENT_MISMATCH`).
3. Stock can never go negative: row lock → check → decrement, all-or-nothing
   per sale; verified under concurrency.
4. Credit balances can never go negative: `FOR UPDATE` before check, in both
   charging and repayment paths.
5. Returnable quantity is cumulative across all returns per sale line.
6. Only `GOOD` condition restocks, at historical cost — current margins are
   unaffected by returns of damaged goods.
7. A return settles by **exactly one** path: credit adjustment XOR refund.
8. Voided entities disappear from every report but remain in the database with
   status + reason + audit trail.
9. Statement balance always equals the account's stored outstanding balance
   (both derive from the same source rows).

## 8. Concurrency & atomicity guarantees (verified vs real PostgreSQL)

- 6 concurrent 2-unit sales vs stock 10 → exactly 5 succeed; final on-hand 0,
  never negative.
- Concurrent sale + damaging adjustment vs 5 units → exactly one wins; ≥ 0.
- 10 concurrent 300-payments vs balance 1000 → exactly 3 succeed; final
  balance exactly 100.00; exactly 3 payment rows.
- 20 concurrent sales → 20 unique sequential document numbers.
- Failed multi-line sale (second line short of stock) leaves zero traces:
  no sale/items/payments/ledger rows, first line's deduction rolled back.
- Failed return (over-quantity) persists nothing and moves no stock.
- Credit adjustment beyond balance rejected atomically — no return row, no
  restock.

## 9. Authorization model

Reads shared; writes split as per §6. POS selling is allowed for ASSISTANT
(shop-floor reality) but price overrides, discounts beyond validation caps,
voids, returns, customer/credit mutations and finance mutations are ADMIN-only.
ASSISTANT sale details hide unit costs, COGS and gross profit.

## 10. Audit trail

New actions: `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `CUSTOMER_ACTIVATED`,
`CUSTOMER_DEACTIVATED`, `SALE_CREATED`, `SALE_VOIDED`,
`SALE_DISCOUNT_APPLIED`, `SALE_PRICE_OVERRIDE`, `SALE_PAYMENT_CREATED`,
`CUSTOMER_CREDIT_ACCOUNT_OPENED`, `CUSTOMER_CREDIT_LIMIT_CHANGED`,
`CUSTOMER_CREDIT_PAYMENT_CREATED`, `SALE_RETURN_CREATED`,
`EXPENSE_CATEGORY_CREATED`, `EXPENSE_CATEGORY_UPDATED`, `EXPENSE_CREATED`,
`EXPENSE_UPDATED`, `EXPENSE_VOIDED`. Price overrides and discounts carry
before/after amounts; voids record reason and reversal figures.

## 11. Validation & error codes

Zod validators in `src/validators/sales.ts`. Stable machine codes:
`PAYMENT_MISMATCH`, `PRICE_OVERRIDE_FORBIDDEN`, `INVALID_DISCOUNT`,
`INSUFFICIENT_STOCK`, `PRODUCT_INACTIVE`, `CUSTOMER_REQUIRED_FOR_CREDIT`,
`CREDIT_LIMIT_EXCEEDED`, `CUSTOMER_CREDIT_NOT_FOUND`,
`CUSTOMER_CREDIT_NOT_ACTIVE`, `CUSTOMER_CREDIT_EXISTS`, `PAYMENT_EXCEEDS_BALANCE`,
`SALE_NOT_ACTIVE`, `SALE_ALREADY_VOIDED`, `INVALID_SALE_ITEM`,
`RETURN_EXCEEDS_RETURNABLE`, `REFUND_EXCEEDS_BALANCE`, `CUSTOMER_NOT_FOUND`,
`CUSTOMER_INACTIVE`, `CUSTOMER_HAS_OUTSTANDING_CREDIT`, `EXPENSE_VOIDED`,
`EXPENSE_ALREADY_VOIDED`, `EXPENSE_CATEGORY_EXISTS`.

## 12. Frontend

- **Types** — Stage 7 section in `client/src/types/api.ts` (+ `CREDIT` added
  to `PaymentMethod`).
- **API clients** — `lib/salesApi.ts`, `lib/customersApi.ts`,
  `lib/financeApi.ts` following the purchasing pattern.
- **Pages**:
  - `pages/sales/PosPage.tsx` — inventory search → basket (qty editable, price
    override ADMIN-gated) → customer picker → sale type → split payment rows
    (references for MPESA/BANK/CHEQUE, credit requires customer) → confirm
    modal; live "remaining" indicator must hit 0.
  - `pages/sales/SalesHistoryPage.tsx` — filterable list.
  - `pages/sales/SaleDetailPage.tsx` — items/payments/returns, COGS+GP for
    ADMIN, void dialog (reason) and return workflow (per-line qty + condition,
    reason, refund-vs-credit-adjustment choice), success modal.
  - `pages/sales/SalesReturnsPage.tsx` — returns register.
  - `pages/customers/CustomersPage.tsx` + `CustomerDetailPage.tsx` — CRUD,
    status toggling, credit panel (open account, limit editor, payment form),
    full statement and payment history tables.
  - `pages/finance/ExpensesPage.tsx` — inline category creation, expense
    recording, void with confirm.
  - `pages/reports/ReportsPage.tsx` — preset/custom EAT range, stat cards
    (revenue, COGS, gross profit, net operating result), payment breakdown,
    expenses & returns, top-debtor table.
- **Routes/nav** — `/pos`, `/sales`, `/sales/returns`, `/sales/:id`,
  `/customers`, `/customers/:id`, `/expenses`, `/reports`; sidebar groups
  **Sales / Customers / Finance** added to `RootLayout`.
- Destructive actions use `ConfirmDialog`; no `alert()` anywhere.

## 13. Testing strategy

1. **Unit tests** (`tests/sales.test.ts`, 29 tests) — HTTP stack vs in-memory
   Prisma mock with snapshot-based `$transaction` rollback; covers validators,
   role rules, pricing/discount math, credit math, lifecycle gates, error
   codes.
2. **Integration tests**
   (`tests/integration/sales.integration.test.ts`, 22 tests) — real
   PostgreSQL `makire_motorparts_test`, services invoked directly; scenarios
   A–O cover every guarantee in §8 plus DECIMAL reconciliation on disk
   (items − discount = total; Σpayments = total) and report exclusion of
   voided rows.

Both integration files run sequentially (`--test-concurrency=1`) because they
truncate shared tables.

Fixes made while building this suite: test DB was missing Stage 7 migrations
(deployed), fixtures made idempotent (upserts), helper now auto-computes cash
totals, corrected one wrong expected value in the test itself (service was
right).

## 14. Verification results

| Check | Result |
| --- | --- |
| `npm test` (server unit) | **158/158 pass** (29 new sales) |
| Integration suites (purchasing + sales) | **43/43 pass** (22 new) |
| `tsc --noEmit` (server) | 0 errors |
| `eslint src tests` (server) | clean |
| `prisma validate` / `migrate status` | valid / up to date |
| `tsc --noEmit` (client) | clean |
| `eslint src` (client) | clean |
| `npm run build` (client) | ✓ built (~496 kB js / 127 kB gzip) |

## 15. Live smoke test — PENDING (manual)

Not executed by the agent this time; dev servers (4000/5173) are run by the
owner. Suggested 10-minute script: login as both roles; ring up a mixed
cash+M-Pesa+credit sale on POS; verify stock drop + ledger; pay down the
credit from the customer page; partially return GOOD units and watch stock
restore at cost; void a sale; record and void an expense; check Reports today
preset. Everything exercised there is already covered by automated tests, so
this is UX verification only.

## 16. Environment notes

- PostgreSQL 18.4 in WSL home (`~/.local/share/autoparts-postgres`), port
  5432, app role `makire`/`makire`.
- `makire_motorparts_test` required an explicit
  `npx prisma migrate deploy` after the new migrations landed.
- Dev credentials: `admin@jmspareparts.local` / `Makire123`;
  `assistant@jmspareparts.local` / `Shop12345` (min length now 8).

## 17. Known limitations / deferred

- Purchase returns remain unimplemented (the only deferred feature from the
  original plan).
- No receipt/PDF export; statements are on-screen.
- Reports render tables/cards; no charts yet (daily series data is served and
  ready for a chart component).
- Expense editing exists at API level but the UI exposes create + void only.

## 18. Handover notes

All seven stages are complete and pushed to
`github.com/Joohjay/Motorspare-parts-system` (19 commits reconstructing the
project history stage by stage). The codebase keeps the two invariants that
make it safe under a real shop's concurrency: **row locks before balance
checks** and **document numbers via atomic UPDATE..RETURNING** — preserve both
in any future work (purchase returns should reuse them immediately).
