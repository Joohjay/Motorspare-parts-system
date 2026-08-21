import { Router } from 'express';

import {
  forgotPassword,
  getCsrfToken,
  login,
  logout,
  me,
  resetPassword,
  updateAccountStatus,
} from '../controllers/authController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Issues/exposes the CSRF token the client echoes back on state-changing
// requests (double-submit cookie). A safe GET — never exempts state-changing
// routes from CSRF checks.
router.get('/csrf', getCsrfToken);

router.post('/login', login);
router.post('/logout', logout);

router.get('/me', requireAuth, me);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Account status management (ADMIN only), protected by the final-admin guard.
router.patch('/users/:id/status', requireAdmin, updateAccountStatus);

export default router;