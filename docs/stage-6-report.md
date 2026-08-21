# Stage 6 Report — Suppliers, Purchasing, Purchase Orders & Receiving

**Project:** MAKIRE MOTORPARTS
**Stage:** 6 of 7
**Date:** 2026-08-21
**Status:** Complete — all verification green

---

## 1. Scope

Stage 6 delivers the procurement side of the business:

- **Suppliers** — master data with contact details, activation lifecycle and
  per-supplier product catalogues (supplier codes, agreed unit costs, lead
  times).
- **Purchase orders** — draft → submitted → (partially) received / cancelled
  lifecycle, with frozen line items and computed totals.
- **Receiving** — goods-receipt notes against purchase orders or as direct
  purchases. Only accepted quantity enters inventory; damaged/missing units are
  recorded but never stocked.
- **Supplier credit** — optional credit account per supplier; receipts on an
  active account automatically increase the outstanding balance; payments
  reduce it and can settle individual purchases.

Out of scope (later stages): sales/POS, customer credit, sale returns, purchase
returns, expenses, reports.

## 2. Schema changes & migration

Migration: `server/prisma/migrations/202608200007_stage6_suppliers_purchasing/`

| Change | Detail |
| --- | --- |
| `SupplierProduct.unitCost` | new nullable `Decimal(12,2)` — the supplier's agreed cost |
| `SupplierProduct.status` | new `SupplierProductStatus` enum (`ACTIVE`/`INACTIVE`), default `ACTIVE`, indexed |
| `PurchaseOrderItem.notes` | new nullable `String` |

The core supplier/purchase-order/purchase/credit tables already existed in the
schema from Stage 1 modelling; this stage only extended them as above.
`prisma generate` was re-run; the migration was applied to **both** the dev
database (`makire_motorparts`) and the integration database
(`makire_motorparts_test`); no drift remains (`prisma migrate status` clean).

## 3. Document numbering

`server/src/utils/documentNumber.ts` — `nextDocumentNumber(tx, documentType)`:

- Atomic `UPDATE document_sequences SET lastNumber = lastNumber + 1 … RETURNING`
  inside the caller's transaction. Concurrent allocations serialize on the row
  lock; numbers can never collide or burn out of order.
- **Never** `MAX(number)+1` — that pattern is racy under concurrency.
- Format `{prefix}-{lastNumber zero-padded to padLength}` → e.g.
  `PURCHASE_ORDER-000001`, `PURCHASE-000001`.
- A failed transaction rolls back the increment, so rejected operations do not
  burn numbers (verified by integration test).
- Fixed during this stage: the raw query needed an explicit
  `::"DocumentType"` cast because Prisma binds JS strings as `text` while the
  column is a native enum.

## 4. Inventory service refactor

`inventoryService.increaseStock` was split into a thin public wrapper plus an
exported transaction-aware core:

```ts
export async function increaseStockTx(tx, input): Promise<InventoryMutationResult>
```

Same logic (weighted-average costing, ledger row with `balanceAfter`,
low-stock notifications) but it joins the caller's transaction so a receipt and
its stock movement commit or roll back **as one unit**.

## 5. Services

### 5.1 supplierService.ts
- `listSuppliers` (search q across name/contact/phone/email, status filter,
  sort, pagination; includes active credit balance), `getSupplier`
  (with linked products).
- `createSupplier`, `updateSupplier`, `setSupplierStatus`
  (activate/deactivate).
- `listSupplierProducts`, `linkSupplierProduct` (unique per pair; product must
  exist and be ACTIVE), `updateSupplierProduct` (code/cost/lead time/status),
  `unlinkSupplierProduct` (delete; history preserved via audit log).

### 5.2 purchaseOrderService.ts
- `createPurchaseOrder` — always created as `DRAFT`; validates supplier is
  ACTIVE, products exist and are ACTIVE, quantities positive, costs ≥ 0, no
  duplicate product lines; computes `totalAmount = Σ qty × unitCost`.
- `updatePurchaseOrder` — DRAFT only; replaces all items in one transaction
  and recomputes the total.
- `submitPurchaseOrder` — DRAFT → PENDING (order becomes immutable).
- `cancelPurchaseOrder` — DRAFT/PENDING only.
- `getPurchaseOrder` — detail includes per-line `received` and `remaining`
  (computed from actual receipts) plus the related purchases.
- `listPurchaseOrders` — filters (status, supplierId, q), sorting, pagination.

### 5.3 purchaseReceivingService.ts
- `createPurchase(body)` — receives against a PO **or** as a direct purchase:
  - PO path: locks the PO row `FOR UPDATE`, verifies status
    (`PENDING`/`PARTIALLY_RECEIVED`), resolves every line against its PO line —
    **unit cost and ordered quantity are taken from the frozen PO line**, never
    from the request; rejects receiving more than the remaining quantity;
    rejects mismatched product ids.
  - Direct path: requires `supplierId`, per-line `unitCost` + `quantityOrdered`.
  - Per line: `damaged + missing ≤ received`; `accepted = received − damaged − missing`;
    accepted > 0 goes through `increaseStockTx` (type `PURCHASE`) in the same tx.
  - `totalAmount = Σ accepted × unitCost` — damaged/missing units are not billed.
  - If the supplier has an **ACTIVE credit account** and total > 0, the balance
    is increased in the same transaction and the purchase is linked to it.
  - `paymentStatus` starts `UNPAID` (or `PAID` when total is 0).
  - Everything happens in one transaction: receipt items, inventory movements,
    credit charge, PO status update, document number.
- `listPurchases` / `getPurchase` — rich detail (items + product, source order,
  credit account, payments, returns placeholder).

### 5.4 supplierCreditService.ts
- `openCreditAccount(supplierId)` — one account per supplier; supplier must be
  ACTIVE.
- `getCreditAccount` — balance, counters, latest 5 payments.
- `listCreditPayments` — date filter, pagination.
- `recordCreditPayment` — locks the account row `FOR UPDATE`; rejects payments
  exceeding the outstanding balance (`SUPPLIER_PAYMENT_EXCEEDS_BALANCE`);
  when a `purchaseId` is given, also rejects exceeding that purchase's own
  remaining amount and updates the purchase's `paymentStatus`
  (UNPAID → PARTIAL → PAID). Returns `{ payment, creditAccount }`.

## 6. API surface

All routes mounted under `/api` in `src/routes/index.ts`:

| Method & path | Purpose | Roles |
| --- | --- | --- |
| GET `/suppliers` | list/search suppliers | ADMIN, ASSISTANT |
| POST `/suppliers` | create supplier | ADMIN |
| GET `/suppliers/:id` | supplier detail + products | ADMIN, ASSISTANT |
| PATCH `/suppliers/:id` | update supplier | ADMIN |
| POST `/suppliers/:id/status` | activate/deactivate | ADMIN |
| GET `/suppliers/:id/products` | linked products | ADMIN, ASSISTANT |
| POST `/suppliers/:id/products` | link product | ADMIN |
| PATCH `/supplier-products/:id` | update link | ADMIN |
| DELETE `/supplier-products/:id` | unlink product | ADMIN |
| GET `/purchase-orders` | list orders | ADMIN, ASSISTANT |
| POST `/purchase-orders` | create draft | ADMIN, ASSISTANT* |
| GET `/purchase-orders/:id` | order detail w/ remaining | ADMIN, ASSISTANT |
| PATCH `/purchase-orders/:id` | edit draft | ADMIN, ASSISTANT* |
| POST `/purchase-orders/:id/submit` | submit order | ADMIN |
| POST `/purchase-orders/:id/cancel` | cancel order | ADMIN |
| GET `/purchases` | list receipts | ADMIN, ASSISTANT |
| POST `/purchases` | receive goods | ADMIN |
| GET `/purchases/:id` | receipt detail | ADMIN, ASSISTANT |
| GET `/supplier-credit/:id` | account summary | ADMIN, ASSISTANT |
| POST `/supplier-credit/:id/account` | open account | ADMIN |
| GET `/supplier-credit/:id/payments` | payment history | ADMIN, ASSISTANT |
| POST `/supplier-credit/:id/payments` | record payment | ADMIN |

\* ASSISTANT may create/edit drafts; submission, cancellation, receiving,
credit and master-data mutations are ADMIN-only (enforced server-side via
`requireRole('ADMIN')`; verified live: assistant mutations return 403).

## 7. Business rules & invariants

1. Ordered ≠ received ≠ accepted ≠ stocked. Only `quantityAccepted` enters
   inventory; only accepted × unitCost is billed.
2. Over-receiving is impossible — cumulative receipts per PO line can never
   exceed `quantityOrdered`, enforced under a row lock so concurrent receipts
   serialize.
3. Damaged + missing ≤ received on every line.
4. Unit costs on PO-linked receipts come from the PO line (frozen at order
   time); requests cannot alter them.
5. A fully received PO flips to `RECEIVED` and refuses further receipts
   (`PURCHASE_ORDER_ALREADY_RECEIVED`).
6. Credit charges happen atomically with the receipt; payments can never drive
   the balance negative; a purchase settles to PAID exactly when its cumulative
   payments reach its total.
7. Document numbers are gap-free under success, never duplicated under
   concurrency, and not burned by failed transactions.

## 8. Concurrency & atomicity guarantees (verified against real PostgreSQL)

- 6 concurrent receipts of 3 against an order of 10 → exactly 3 succeed, 3
  rejected with `RECEIVED_QUANTITY_EXCEEDS_ORDERED`; final state consistent.
- 6 concurrent 200-payments against a 550 balance → exactly 2 succeed; balance
  lands at exactly 150.00, never negative.
- 12 concurrent document-number allocations → 12 unique sequential values.
- An over-receiving request persists nothing (no purchase row, no ledger row,
  no burned number).
- Weighted-average costing through receipts persisted as exact DECIMAL
  (10 @ 100 then 10 @ 200 → `150.00` on disk; ledger freezes each receipt cost).

## 9. Authorization model

See table in §6. Implemented with the existing `requireAuth` +
`requireRole('ADMIN')` middleware. Read access is shared; every mutating
procurement endpoint except draft creation/editing is ADMIN-only. Live smoke
verified: assistant create-supplier → 403, assistant receive → 403, assistant
reads → 200.

## 10. Audit trail

New actions in `src/constants/auditActions.ts`: `SUPPLIER_CREATED`,
`SUPPLIER_UPDATED`, `SUPPLIER_DEACTIVATED`, `SUPPLIER_ACTIVATED`,
`SUPPLIER_PRODUCT_LINKED`, `SUPPLIER_PRODUCT_UPDATED`,
`SUPPLIER_PRODUCT_UNLINKED`, `PURCHASE_ORDER_CREATED`,
`PURCHASE_ORDER_UPDATED`, `PURCHASE_ORDER_SUBMITTED`,
`PURCHASE_ORDER_CANCELLED`, `PURCHASE_CREATED`,
`SUPPLIER_CREDIT_ACCOUNT_OPENED`, `SUPPLIER_CREDIT_PAYMENT_RECORDED`.
Payments record the resulting outstanding balance in `afterState`.

## 11. Validation & error codes

Zod validators in `src/validators/purchasing.ts` shape every request body/query.
Domain errors use stable machine codes:

`SUPPLIER_NOT_FOUND`, `SUPPLIER_INACTIVE`, `PRODUCT_NOT_FOUND`,
`PRODUCT_INACTIVE`, `SUPPLIER_PRODUCT_EXISTS`, `SUPPLIER_PRODUCT_NOT_FOUND`,
`PURCHASE_ORDER_NOT_FOUND`, `INVALID_PURCHASE_ORDER_STATUS`,
`PURCHASE_ORDER_ALREADY_RECEIVED`, `RECEIVED_QUANTITY_EXCEEDS_ORDERED`,
`INVALID_RECEIVING_QUANTITY`, `DUPLICATE_PURCHASE_ORDER_ITEM`,
`PURCHASE_NOT_FOUND`, `SUPPLIER_CREDIT_NOT_FOUND`, `SUPPLIER_CREDIT_EXISTS`,
`SUPPLIER_CREDIT_NOT_ACTIVE`, `SUPPLIER_PAYMENT_EXCEEDS_BALANCE`.

## 12. Frontend

- **Types** — Stage 6 section appended to `client/src/types/api.ts`
  (Supplier, SupplierProduct, PurchaseOrder(+Item), Purchase(+Item),
  SupplierCreditAccount/Payment, inputs, enums).
- **API client** — `client/src/lib/purchasingApi.ts`: `suppliersApi`,
  `purchaseOrdersApi`, `purchasesApi`, `supplierCreditApi` + label/class maps.
- **Pages** (`client/src/pages/purchasing/`):
  - `SuppliersPage` — search/filter list, create/edit modal, activate/
    deactivate confirm, per-supplier linked-products modal (link/unlink).
  - `PurchaseOrdersPage` — status filter, draft editor with dynamic line
    items, submit/cancel confirms, read-only detail modal showing
    ordered/received/remaining per line.
  - `PurchasesPage` — receipts list + payment-status filter, "Receive stock"
    modal supporting both PO mode (per-line received/damaged/missing vs
    remaining) and direct-purchase mode, receipt detail modal.
  - `SupplierCreditPage` — supplier picker, balance summary, recent payments,
    record-payment form (admin), open-account flow.
- **Routes** — `/purchasing/suppliers`, `/purchasing/purchase-orders`,
  `/purchasing/purchases`, `/purchasing/credit` inside `ProtectedRoute`;
  admin-only UI actions hidden for ASSISTANT (server enforces regardless).
- **Nav** — "Purchasing" link in the header; cross-links between purchasing
  pages.

## 13. Testing strategy

Two layers:

1. **Unit tests** (`tests/purchasing.test.ts`, 43 tests) — run the HTTP stack
   against a full in-memory Prisma mock (custom harness with relation-aware
   include attachment, serialized `$transaction`s, SQL-text branching for
   `$queryRaw`). Covers validation, role enforcement, lifecycle rules,
   totals, credit math, error codes.
2. **Integration tests**
   (`tests/integration/purchasing.integration.test.ts`, 9 tests) — real
   PostgreSQL (`makire_motorparts_test`), services called directly. Covers the
   guarantees mocks cannot: row-lock serialization for receiving and payments,
   atomic rollback of failed receipts, DECIMAL persistence, document-number
   uniqueness under concurrency, status transitions.

`test:integration` now runs files sequentially
(`--test-concurrency=1`) because both integration files truncate shared tables
and would otherwise interfere.

## 14. Verification results

| Check | Result |
| --- | --- |
| `npm test` (server unit) | **129/129 pass** (43 purchasing) |
| `npm run test:integration` | **21/21 pass** (9 purchasing + 12 inventory) |
| `npm run typecheck` (server) | 0 errors |
| `npm run lint` (server) | clean |
| `npm run typecheck` (client) | clean |
| `npm run lint` (client) | clean |
| `npm run build` (client) | ✓ built (~439 kB js) |
| Live smoke (dev DB, real server) | see §15 |

## 15. Live smoke test (end-to-end on dev database)

Server started with `npm run dev` against PostgreSQL 18.4:

1. CSRF + login as admin → 200.
2. Created supplier "Smoke Test Spares" → 201.
3. Created PO `PURCHASE_ORDER-000001` (10 × 55 = 550) → 201, DRAFT.
4. Submitted → PENDING.
5. Received 6, 1 damaged → `PURCHASE-000001`, total **275** (5 accepted × 55),
   PO → PARTIALLY_RECEIVED, inventory +5.
6. Opened credit account → ACTIVE, balance 0.
7. Received remaining 4 → total 220, **auto-charged to credit** (balance 220),
   PO → RECEIVED.
8. Payments 100 + 100 + 20 → balance exactly 0; overpayment attempt (120 > 20)
   correctly rejected `SUPPLIER_PAYMENT_EXCEEDS_BALANCE`.
9. Assistant role: mutations 403, reads 200.
10. Inventory after receipts: on-hand 11 (= 2 pre-existing + 9 accepted),
    weighted average 45.00 (blends seeded zero-cost stock with receipts at 55)
    — correct weighted-average behaviour.

Smoke data left in the dev DB intentionally (useful demo data); no smoke data
touches the integration DB outside tests (truncated every run).

## 16. Environment notes

- PostgreSQL lives in the WSL home directory
  (`~/.local/share/autoparts-postgres/pgdata`, binaries in
  `~/.cache/autoparts-postgres/pg-18.4.0`), listening on 127.0.0.1:5432,
  superuser `autoparts` (socket/trust), app role `makire`/`makire` (TCP/scram).
- A throwaway psql client was extracted to `/tmp/opencode/pgclient` for
  debugging; `/tmp` does not survive WSL restarts — the database itself does.
- Integration tests derive their connection from `DATABASE_URL` by replacing
  the database name with `makire_motorparts_test` (or honour
  `TEST_DATABASE_URL`).

## 17. Known limitations / deferred

- Purchase returns, sales, customer credit, expenses and reporting are later
  stages (`returns` relation already included in purchase detail responses).
- No supplier statement PDF/export; credit page shows on-screen history only.
- Draft PO editing replaces all lines wholesale (no per-line patch) — matches
  the simple workflow; can be refined later without API breaks.
- No email/notification hooks for PO submission yet (notification plumbing
  exists for low stock only).

## 18. Handover notes

- Stage 7 (final) covers sales/POS, customer credit, sale returns, expenses
  and reporting. Nothing in Stage 6 blocks it; the `SALE` document sequence
  and inventory `decreaseStockTx`-style primitives are ready to mirror.
- Keep the two invariants that make this stage safe: **row locks before
  balance checks** (PO receiving, credit payments) and **document numbers via
  atomic UPDATE..RETURNING**. Reuse them for sales.
- When adding client pages for Stage 7, follow the purchasing pages' pattern:
  typed api module in `lib/`, modal-driven forms, ConfirmDialog for destructive
  actions, role-gated action buttons.
