import { Router } from 'express';

import * as purchaseController from '../controllers/purchaseController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', purchaseController.listPurchases);
router.post('/', requireAdmin, purchaseController.createPurchase);
router.get('/:id', purchaseController.getPurchase);

export default router;