import { Router } from 'express';

import {
  createProduct,
  deleteProduct,
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

// Mutations: ADMIN only. Products with history are soft-deactivated, never deleted.
router.post('/', requireAdmin, createProduct);
router.patch('/:id', requireAdmin, updateProduct);
router.patch('/:id/status', requireAdmin, updateProductStatus);
router.delete('/:id', requireAdmin, deleteProduct);

export default router;