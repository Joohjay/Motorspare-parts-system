import { Router } from 'express';

import {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  updateCategoryStatus,
} from '../controllers/categoryController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Read access: any authenticated user.
router.get('/', requireAuth, listCategories);
router.get('/:id', requireAuth, getCategory);

// Mutations: ADMIN only. No DELETE — categories are soft-deactivated, never
// physically deleted, and deactivation is rejected while products reference them.
router.post('/', requireAdmin, createCategory);
router.patch('/:id', requireAdmin, updateCategory);
router.patch('/:id/status', requireAdmin, updateCategoryStatus);

export default router;