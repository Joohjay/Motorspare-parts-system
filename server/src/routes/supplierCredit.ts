import { Router } from 'express';

import * as supplierCreditController from '../controllers/supplierCreditController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/:id', supplierCreditController.getCreditAccount);
router.post('/:id/account', requireAdmin, supplierCreditController.openCreditAccount);
router.get('/:id/payments', supplierCreditController.listCreditPayments);
router.post('/:id/payments', requireAdmin, supplierCreditController.recordCreditPayment);

export default router;