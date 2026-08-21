import { Router } from 'express';

import * as supplierController from '../controllers/supplierController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', supplierController.listSuppliers);
router.post('/', requireAdmin, supplierController.createSupplier);
router.get('/:id', supplierController.getSupplier);
router.patch('/:id', requireAdmin, supplierController.updateSupplier);
router.post('/:id/status', requireAdmin, supplierController.updateSupplierStatus);
router.get('/:id/products', supplierController.listSupplierProducts);
router.post('/:id/products', requireAdmin, supplierController.linkSupplierProduct);

export default router;