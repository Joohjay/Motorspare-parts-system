import { Router } from 'express';

import {
  createMake,
  createModel,
  createVariant,
  getMake,
  getModel,
  getVariant,
  listMakes,
  listModels,
  listVariants,
  updateMake,
  updateMakeStatus,
  updateModel,
  updateModelStatus,
  updateVariant,
  updateVariantStatus,
} from '../controllers/motorcycleController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Makes
router.get('/makes', requireAuth, listMakes);
router.get('/makes/:id', requireAuth, getMake);
router.post('/makes', requireAdmin, createMake);
router.patch('/makes/:id', requireAdmin, updateMake);
router.patch('/makes/:id/status', requireAdmin, updateMakeStatus);

// Models
router.get('/models', requireAuth, listModels);
router.get('/models/:id', requireAuth, getModel);
router.post('/models', requireAdmin, createModel);
router.patch('/models/:id', requireAdmin, updateModel);
router.patch('/models/:id/status', requireAdmin, updateModelStatus);

// Variants (also serves the compatibility-search cascade: makeId/modelId
// filters and free-text make/model/variant name search).
router.get('/variants', requireAuth, listVariants);
router.get('/variants/:id', requireAuth, getVariant);
router.post('/variants', requireAdmin, createVariant);
router.patch('/variants/:id', requireAdmin, updateVariant);
router.patch('/variants/:id/status', requireAdmin, updateVariantStatus);

export default router;