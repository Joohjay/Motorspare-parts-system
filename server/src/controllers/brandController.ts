import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  brandCreateSchema,
  brandUpdateSchema,
  idParamSchema,
  namedListQuery,
  statusUpdateSchema,
} from '../validators/catalog.js';
import * as brandService from '../services/brandService.js';

export const listBrands = asyncHandler(async (req: Request, res: Response) => {
  const query = namedListQuery.parse(req.query);
  const result = await brandService.listBrands(query);
  res.json(result);
});

export const getBrand = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ brand: await brandService.getBrand(id) });
});

export const createBrand = asyncHandler(async (req: Request, res: Response) => {
  const body = brandCreateSchema.parse(req.body);
  const brand = await brandService.createBrand(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ brand });
});

export const updateBrand = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = brandUpdateSchema.parse(req.body);
  const brand = await brandService.updateBrand(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ brand });
});

export const updateBrandStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const brand = await brandService.setBrandStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ brand });
});