import { Router } from 'express';

import * as supplierController from '../controllers/supplierController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.patch('/:id', requireAdmin, supplierController.updateSupplierProduct);
router.delete('/:id', requireAdmin, supplierController.unlinkSupplierProduct);

export default router;