import { Router } from 'express';

import * as financeController from '../controllers/financeController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Expense categories
router.get('/expense-categories', financeController.listExpenseCategories);
router.post('/expense-categories', requireAdmin, financeController.createExpenseCategory);
router.patch('/expense-categories/:id', requireAdmin, financeController.updateExpenseCategory);

// Expenses (financial records — ADMIN mutates, both roles view)
router.get('/expenses', financeController.listExpenses);
router.post('/expenses', requireAdmin, financeController.createExpense);
router.patch('/expenses/:id', requireAdmin, financeController.updateExpense);
router.post('/expenses/:id/void', requireAdmin, financeController.voidExpense);

// Reports
router.get('/reports/sales', financeController.salesReport);
router.get('/reports/financial', financeController.financialReport);
router.get('/reports/credit', financeController.creditReport);
router.get('/reports/expenses', financeController.expensesReport);

export default router;
