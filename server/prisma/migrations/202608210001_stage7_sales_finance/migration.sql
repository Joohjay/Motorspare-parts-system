-- Stage 7 — sales/POS, customer credit, returns & expenses
--
-- Extends the Stage 2 sales/finance entities with the fields the business
-- rules require. All changes are additive; no existing data is modified.
--
-- NOTE: the Stage 2 migration already established CHECK constraints for
-- quantities/prices/discounts/payment amounts/credit balances (including
-- sales_discount_not_exceed_subtotal and credit balance-within-limit), so
-- this migration only adds what is genuinely new.

-- Customer classification (reporting + pricing hints)
CREATE TYPE "CustomerType" AS ENUM ('RETAIL', 'WHOLESALE', 'MECHANIC', 'GARAGE', 'BUSINESS', 'OTHER');
ALTER TABLE "customers" ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'RETAIL';

-- Frozen historical COGS on sale items (weighted-average cost at sale time)
ALTER TABLE "sale_items" ADD COLUMN "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sale_items" ADD COLUMN "lineCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_cost_non_negative" CHECK ("unitCost" >= 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_line_cost_non_negative" CHECK ("lineCost" >= 0);

-- Return condition classification
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'OTHER');
ALTER TABLE "sale_return_items" ADD COLUMN "condition" "ReturnCondition" NOT NULL DEFAULT 'GOOD';

-- Refund settlement on sale returns. CREDIT_ADJUSTMENT is represented by a
-- null refundMethod together with creditAdjusted = true (the customer's
-- outstanding balance was reduced instead of paying money back).
ALTER TABLE "sale_returns" ADD COLUMN "refundMethod" "PaymentMethod";
ALTER TABLE "sale_returns" ADD COLUMN "refundReference" TEXT;
ALTER TABLE "sale_returns" ADD COLUMN "creditAdjusted" BOOLEAN NOT NULL DEFAULT false;

-- Expense void lifecycle (no physical deletes of financial records)
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'VOIDED');
ALTER TABLE "expenses" ADD COLUMN "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE';
