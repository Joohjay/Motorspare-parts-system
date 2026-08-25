-- Stage 8: purchase returns settlement columns + document sequence seed.
--
-- The purchase_returns / purchase_return_items tables and the
-- PURCHASE_RETURN DocumentType already exist from the Stage 2 modelling;
-- this migration only adds the supplier-settlement fields (mirroring the
-- sale_returns pattern) and seeds the document sequence row.

ALTER TABLE "purchase_returns"
  ADD COLUMN "creditedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refundMethod" "PaymentMethod",
  ADD COLUMN "refundReference" TEXT;

INSERT INTO "document_sequences" ("id", "documentType", "prefix", "lastNumber", "padLength", "updatedAt")
VALUES (gen_random_uuid()::text, 'PURCHASE_RETURN'::"DocumentType", 'PURCHASE_RETURN', 0, 6, NOW())
ON CONFLICT ("documentType") DO NOTHING;
