import { Router } from 'express';

import * as settingsController from '../controllers/settingsController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', settingsController.getSettings);
router.put('/', requireAdmin, settingsController.updateSettings);

export default router;
