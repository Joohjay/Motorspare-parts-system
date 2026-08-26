-- ====================================================================
--  JM SPAREPARTS — Database Cleanup Script
-- ====================================================================
--
--  WHAT THIS SCRIPT DOES:
--    Deletes ALL products, sales, purchases, inventory, suppliers,
--    customers, and expenses from the database. This prepares the
--    system for a fresh start when going live.
--
--  WHAT IS KEPT (NOT DELETED):
--    ✓ Users (admin + assistant accounts)
--    ✓ Settings (business name, tax config, etc.)
--    ✓ Document sequences (reset to 0)
--    ✓ Audit logs (for compliance)
--    ✓ Notifications (will be regenerated)
--    ✓ Password reset tokens
--
--  WHAT IS DELETED:
--    ✗ Products, categories, brands
--    ✗ Motorcycle makes, models, variants
--    ✗ Product identifiers, compatibilities
--    ✗ Suppliers, supplier products, supplier credit
--    ✗ Customers, customer credit
--    ✗ Sales, sale items, payments, sale returns
--    ✗ Purchase orders, purchases, purchase items, purchase returns
--    ✗ Inventory records, inventory transactions
--    ✗ Stock reservations
--    ✗ Expenses, expense categories
--
--  HOW TO RUN:
--    1. Open Command Prompt (Windows) or Terminal
--    2. Navigate to the project folder
--    3. Run: psql -U makire -d makire_motorparts -f scripts\cleanup.sql
--    4. Enter password when prompted (default: makire)
--
--  ⚠️  WARNING: THIS DEALLS ALL DATA. MAKE A BACKUP FIRST!
--    Run: scripts\backup.bat
--
-- ====================================================================

-- Disable triggers temporarily to avoid cascading issues
SET session_replication_role = 'replica';

-- ====================================================================
-- 1. Delete transactional data (order matters due to foreign keys)
-- ====================================================================

-- Sale return items (references sale_items, sale_returns)
DELETE FROM sale_return_items;

-- Sale returns (references sales, customers)
DELETE FROM sale_returns;

-- Payments (references sales)
DELETE FROM payments;

-- Sale items (references sales, products)
DELETE FROM sale_items;

-- Sales (references customers, users)
DELETE FROM sales;

-- Purchase return items (references purchase_items, purchase_returns)
DELETE FROM purchase_return_items;

-- Purchase returns (references purchases, suppliers)
DELETE FROM purchase_returns;

-- Supplier credit payments (references purchases, supplier_credit_accounts)
DELETE FROM supplier_credit_payments;

-- Purchase items (references purchases, products, purchase_order_items)
DELETE FROM purchase_items;

-- Purchase orders (references suppliers, users)
DELETE FROM purchase_orders;

-- Purchases (references suppliers, users)
DELETE FROM purchases;

-- Supplier credit accounts (references suppliers)
DELETE FROM supplier_credit_accounts;

-- Customer credit payments (references customer_credit_accounts)
DELETE FROM customer_credit_payments;

-- Customer credit accounts (references customers)
DELETE FROM customer_credit_accounts;

-- Stock reservations (references products, users)
DELETE FROM stock_reservations;

-- Inventory transactions (references products, users)
DELETE FROM inventory_transactions;

-- Inventory records (references products)
DELETE FROM inventories;

-- Product compatibilities (references products, motorcycle_variants)
DELETE FROM product_compatibilities;

-- Product identifiers (references products)
DELETE FROM product_identifiers;

-- Supplier products (references suppliers, products)
DELETE FROM supplier_products;

-- Expenses (references expense_categories, users)
DELETE FROM expenses;

-- Expense categories
DELETE FROM expense_categories;

-- ====================================================================
-- 2. Delete catalog data
-- ====================================================================

-- Products (references categories, brands)
DELETE FROM products;

-- Motorcycle variants (references motorcycle_models)
DELETE FROM motorcycle_variants;

-- Motorcycle models (references motorcycle_makes)
DELETE FROM motorcycle_models;

-- Motorcycle makes
DELETE FROM motorcycle_makes;

-- Brands
DELETE FROM brands;

-- Categories (self-referencing, delete children first)
DELETE FROM categories;

-- Suppliers
DELETE FROM suppliers;

-- Customers
DELETE FROM customers;

-- ====================================================================
-- 3. Reset document sequences to 0
-- ====================================================================

UPDATE document_sequences SET "lastNumber" = 0;

-- ====================================================================
-- 4. Clear audit logs and notifications (optional — uncomment if needed)
-- ====================================================================

-- DELETE FROM notifications;
-- DELETE FROM audit_logs;

-- ====================================================================
-- 5. Re-enable triggers
-- ====================================================================

SET session_replication_role = 'origin';

-- ====================================================================
-- 6. Verify cleanup
-- ====================================================================

SELECT 'Products' AS table_name, COUNT(*) AS remaining FROM products
UNION ALL SELECT 'Categories', COUNT(*) FROM categories
UNION ALL SELECT 'Brands', COUNT(*) FROM brands
UNION ALL SELECT 'Motorcycle Makes', COUNT(*) FROM motorcycle_makes
UNION ALL SELECT 'Motorcycle Models', COUNT(*) FROM motorcycle_models
UNION ALL SELECT 'Motorcycle Variants', COUNT(*) FROM motorcycle_variants
UNION ALL SELECT 'Suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'Customers', COUNT(*) FROM customers
UNION ALL SELECT 'Sales', COUNT(*) FROM sales
UNION ALL SELECT 'Purchase Orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'Purchases', COUNT(*) FROM purchases
UNION ALL SELECT 'Inventory', COUNT(*) FROM inventories
UNION ALL SELECT 'Expenses', COUNT(*) FROM expenses
UNION ALL SELECT 'Users', COUNT(*) FROM users
UNION ALL SELECT 'Settings', COUNT(*) FROM settings;

-- Done!
SELECT '✅ Database cleaned successfully! System is ready for fresh data.' AS result;
