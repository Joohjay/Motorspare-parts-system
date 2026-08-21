-- CreateEnum
CREATE TYPE "SupplierProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "supplier_products" ADD COLUMN     "status" "SupplierProductStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "unitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE INDEX "supplier_products_status_idx" ON "supplier_products"("status");