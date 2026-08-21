-- CREDIT as a sale payment allocation: the portion of a sale charged to the
-- customer's credit account. Keeps every payment row in one table so
-- reconciliation (payments + credit = sale total) is a single query.
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';
