import { Router } from 'express';

import * as notificationController from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', notificationController.listNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.post('/mark-all-read', notificationController.markAllNotificationsRead);
router.post('/:id/read', notificationController.markNotificationRead);

export default router;
