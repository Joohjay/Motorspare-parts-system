import { Router } from 'express';

import * as saleController from '../controllers/saleController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Sales / POS
router.get('/', saleController.listSales);
router.post('/', requireAuth, saleController.createSale);
router.get('/:id', saleController.getSale);
// Stage 8 — printable receipt (frozen snapshot + current business settings)
router.get('/:id/receipt', saleController.getSaleReceipt);
router.post('/:id/void', requireAdmin, saleController.voidSale);

// Sales returns (financially sensitive — ADMIN processes them)
router.post('/:id/returns', requireAdmin, saleController.createSaleReturn);

export default router;
