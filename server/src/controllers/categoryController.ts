import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  categoryCreateSchema,
  categoryListQuery,
  categoryUpdateSchema,
  idParamSchema,
  statusUpdateSchema,
} from '../validators/catalog.js';
import * as categoryService from '../services/categoryService.js';

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryListQuery.parse(req.query);
  const result = await categoryService.listCategories(query);
  res.json(result);
});

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ category: await categoryService.getCategory(id) });
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const body = categoryCreateSchema.parse(req.body);
  const category = await categoryService.createCategory(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ category });
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = categoryUpdateSchema.parse(req.body);
  const category = await categoryService.updateCategory(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ category });
});

export const updateCategoryStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const category = await categoryService.setCategoryStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ category });
});