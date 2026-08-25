import { Router } from 'express';

import * as purchaseController from '../controllers/purchaseController.js';
import * as purchaseReturnController from '../controllers/purchaseReturnController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', purchaseController.listPurchases);
router.post('/', requireAdmin, purchaseController.createPurchase);
router.get('/:id', purchaseController.getPurchase);
// Stage 8 — purchase returns (ADMIN): created against a completed purchase.
router.post('/:id/returns', requireAdmin, purchaseReturnController.createPurchaseReturn);

export default router;