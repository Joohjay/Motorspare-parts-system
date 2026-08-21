import { Router } from 'express';

import {
  createBrand,
  getBrand,
  listBrands,
  updateBrand,
  updateBrandStatus,
} from '../controllers/brandController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listBrands);
router.get('/:id', requireAuth, getBrand);

router.post('/', requireAdmin, createBrand);
router.patch('/:id', requireAdmin, updateBrand);
router.patch('/:id/status', requireAdmin, updateBrandStatus);

export default router;