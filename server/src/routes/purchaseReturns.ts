import { Router } from 'express';

import * as purchaseReturnController from '../controllers/purchaseReturnController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', purchaseReturnController.listPurchaseReturns);
router.get('/:id', purchaseReturnController.getPurchaseReturn);
router.post('/:id/cancel', requireAdmin, purchaseReturnController.cancelPurchaseReturn);

export default router;
