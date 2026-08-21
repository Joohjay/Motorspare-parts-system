import { Router } from 'express';

import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  updateProductStatus,
} from '../controllers/productController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Read/search access: any authenticated user.
router.get('/', requireAuth, listProducts);
router.get('/:id', requireAuth, getProduct);

// Mutations: ADMIN only. Products are soft-deactivated, never deleted.
router.post('/', requireAdmin, createProduct);
router.patch('/:id', requireAdmin, updateProduct);
router.patch('/:id/status', requireAdmin, updateProductStatus);

export default router;