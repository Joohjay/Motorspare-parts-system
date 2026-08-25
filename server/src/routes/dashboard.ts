import { Router } from 'express';

import * as dashboardController from '../controllers/dashboardController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', dashboardController.getDashboard);

export default router;
