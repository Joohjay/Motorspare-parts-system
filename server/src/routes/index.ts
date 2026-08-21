import { Router } from 'express';

import authRouter from './auth.js';
import brandsRouter from './brands.js';
import categoriesRouter from './categories.js';
import compatibilityRouter from './compatibility.js';
import customersRouter from './customers.js';
import financeRouter from './finance.js';
import healthRouter from './health.js';
import inventoryRouter from './inventory.js';
import motorcyclesRouter from './motorcycles.js';
import productsRouter from './products.js';
import salesReturnsRouter from './salesReturns.js';
import salesRouter from './sales.js';
import purchaseOrdersRouter from './purchaseOrders.js';
import purchasesRouter from './purchases.js';
import supplierCreditRouter from './supplierCredit.js';
import supplierProductsRouter from './supplierProducts.js';
import suppliersRouter from './suppliers.js';

const router = Router();

router.use('/customers', customersRouter);
router.use('/sales', salesRouter);
router.use('/sales-returns', salesReturnsRouter);
router.use('/finance', financeRouter);
router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/categories', categoriesRouter);
router.use('/brands', brandsRouter);
router.use('/motorcycles', motorcyclesRouter);
router.use('/products', productsRouter);
router.use('/compatibility', compatibilityRouter);
router.use('/inventory', inventoryRouter);
router.use('/suppliers', suppliersRouter);
router.use('/supplier-products', supplierProductsRouter);
router.use('/purchase-orders', purchaseOrdersRouter);
router.use('/purchases', purchasesRouter);
router.use('/supplier-credit', supplierCreditRouter);

export default router;