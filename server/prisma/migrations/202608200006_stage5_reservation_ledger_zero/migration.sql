-- Stage 5: allow zero-quantity rows in the inventory ledger ONLY for reservation
-- reference rows (RESERVATION / RESERVATION_RELEASE). Reservations change
-- availability, not on-hand, so their ledger reference rows carry quantity 0 and
-- balanceAfter = on-hand. This relaxes the Stage 2 integrity constraint while
-- preserving its intent: arbitrary zero-quantity rows are still forbidden.

ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_quantity_non_zero";

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_quantity_non_zero"
  CHECK ("quantity" <> 0 OR "type" IN ('RESERVATION', 'RESERVATION_RELEASE'));