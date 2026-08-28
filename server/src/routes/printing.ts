import { Router } from 'express';

import * as printingController from '../controllers/printingController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/printers', printingController.listPrinters);
router.post('/receipt/:id', printingController.printSaleReceipt);

export default router;