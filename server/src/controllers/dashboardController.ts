import type { Request, Response } from 'express';

import * as dashboardService from '../services/dashboardService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  res.json({ dashboard: await dashboardService.getDashboard(actor.role) });
});
