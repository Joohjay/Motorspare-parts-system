import { Router } from 'express';

import * as saleController from '../controllers/saleController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', saleController.listSaleReturns);
router.get('/:id', saleController.getSaleReturn);

export default router;
