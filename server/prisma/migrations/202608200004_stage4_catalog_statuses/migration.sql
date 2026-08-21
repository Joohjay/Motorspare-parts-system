-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MotorcycleMakeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MotorcycleModelStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MotorcycleVariantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "motorcycle_makes" ADD COLUMN     "status" "MotorcycleMakeStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "motorcycle_models" ADD COLUMN     "status" "MotorcycleModelStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "motorcycle_variants" ADD COLUMN     "status" "MotorcycleVariantStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "categories_status_idx" ON "categories"("status");

-- CreateIndex
CREATE INDEX "brands_status_idx" ON "brands"("status");

-- CreateIndex
CREATE INDEX "motorcycle_makes_status_idx" ON "motorcycle_makes"("status");

-- CreateIndex
CREATE INDEX "motorcycle_models_status_idx" ON "motorcycle_models"("status");

-- CreateIndex
CREATE INDEX "motorcycle_variants_status_idx" ON "motorcycle_variants"("status");

