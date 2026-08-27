import { Router } from 'express';

import authRouter from './auth.js';
import brandsRouter from './brands.js';
import compatibilityRouter from './compatibility.js';
import financeRouter from './finance.js';
import healthRouter from './health.js';
import inventoryRouter from './inventory.js';
import motorcyclesRouter from './motorcycles.js';
import productsRouter from './products.js';
import salesRouter from './sales.js';
import purchaseOrdersRouter from './purchaseOrders.js';
import dashboardRouter from './dashboard.js';
import notificationsRouter from './notifications.js';
import settingsRouter from './settings.js';
import purchasesRouter from './purchases.js';
import supplierCreditRouter from './supplierCredit.js';
import supplierProductsRouter from './supplierProducts.js';
import suppliersRouter from './suppliers.js';

const router = Router();

router.use('/sales', salesRouter);
router.use('/finance', financeRouter);
router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/brands', brandsRouter);
router.use('/motorcycles', motorcyclesRouter);
router.use('/products', productsRouter);
router.use('/compatibility', compatibilityRouter);
router.use('/inventory', inventoryRouter);
router.use('/suppliers', suppliersRouter);
router.use('/supplier-products', supplierProductsRouter);
router.use('/purchase-orders', purchaseOrdersRouter);
router.use('/purchases', purchasesRouter);
router.use('/dashboard', dashboardRouter);
router.use('/notifications', notificationsRouter);
router.use('/settings', settingsRouter);
router.use('/supplier-credit', supplierCreditRouter);

export default router;