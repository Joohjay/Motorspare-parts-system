import { Router } from 'express';

import {
  adjust,
  getInventory,
  listInventory,
  listLowStock,
  listTransactions,
} from '../controllers/inventoryController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Reads are available to any authenticated user.
router.get('/', requireAuth, listInventory);
router.get('/low-stock', requireAuth, listLowStock);

// Mutations: ADMIN only. Stock movements via purchasing/sales land here later;
// the ledger and adjustments are managed through these endpoints.
router.post('/:productId/adjust', requireAdmin, adjust);

// Literal paths are registered before the /:productId parameterized routes.
router.get('/:productId', requireAuth, getInventory);
router.get('/:productId/transactions', requireAuth, listTransactions);

export default router;