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
import dashboardRouter from './dashboard.js';
import notificationsRouter from './notifications.js';
import settingsRouter from './settings.js';
import printingRouter from './printing.js';

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
router.use('/dashboard', dashboardRouter);
router.use('/notifications', notificationsRouter);
router.use('/settings', settingsRouter);
router.use('/printing', printingRouter);

export default router;