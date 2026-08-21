-- AlterTable
ALTER TABLE "inventories" ADD COLUMN     "weightedAverageCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "balanceAfter" INTEGER NOT NULL,
ADD COLUMN     "unitCost" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "inventory_transactions_type_createdAt_idx" ON "inventory_transactions"("type", "createdAt");