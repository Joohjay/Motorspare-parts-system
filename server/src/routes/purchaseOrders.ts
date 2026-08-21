import { Router } from 'express';

import * as purchaseOrderController from '../controllers/purchaseOrderController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', purchaseOrderController.listPurchaseOrders);
router.post('/', purchaseOrderController.createPurchaseOrder);
router.get('/:id', purchaseOrderController.getPurchaseOrder);
router.patch('/:id', purchaseOrderController.updatePurchaseOrder);
router.post('/:id/submit', requireAdmin, purchaseOrderController.submitPurchaseOrder);
router.post('/:id/cancel', requireAdmin, purchaseOrderController.cancelPurchaseOrder);

export default router;