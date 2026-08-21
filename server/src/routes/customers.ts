import { Router } from 'express';

import * as customerController from '../controllers/customerController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', customerController.listCustomers);
router.post('/', requireAdmin, customerController.createCustomer);
router.get('/:id', customerController.getCustomer);
router.patch('/:id', requireAdmin, customerController.updateCustomer);
router.patch('/:id/status', requireAdmin, customerController.setCustomerStatus);

// Customer credit
router.post('/:id/credit-account', requireAdmin, customerController.openCreditAccount);
router.get('/:id/credit-account', customerController.getCreditAccount);
router.patch('/:id/credit-limit', requireAdmin, customerController.setCreditLimit);
router.post('/:id/credit-payments', requireAdmin, customerController.recordCreditPayment);
router.get('/:id/credit-payments', customerController.listCreditPayments);
router.get('/:id/statement', customerController.getStatement);

export default router;
