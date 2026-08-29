-- Add owner buying price (cost) to products
ALTER TABLE "products" ADD COLUMN "costPrice" DECIMAL(12, 2) NOT NULL DEFAULT 0;