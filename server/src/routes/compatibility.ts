import { Router } from 'express';

import {
  addCompatibility,
  listForProduct,
  removeCompatibility,
} from '../controllers/compatibilityController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Reverse lookup: every motorcycle linked to a product.
router.get('/products/:id', requireAuth, listForProduct);

// Standalone add/remove of a product <-> variant link (ADMIN only).
router.post('/', requireAdmin, addCompatibility);
router.delete('/:id', requireAdmin, removeCompatibility);

export default router;