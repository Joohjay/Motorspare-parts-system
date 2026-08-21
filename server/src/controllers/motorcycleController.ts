import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  makeCreateSchema,
  makeUpdateSchema,
  modelCreateSchema,
  modelListQuery,
  modelUpdateSchema,
  namedListQuery,
  statusUpdateSchema,
  variantCreateSchema,
  variantListQuery,
  variantUpdateSchema,
} from '../validators/catalog.js';
import * as motorcycleService from '../services/motorcycleService.js';

// ---------------------------------------------------------------------------
// Makes
// ---------------------------------------------------------------------------

export const listMakes = asyncHandler(async (req: Request, res: Response) => {
  const query = namedListQuery.parse(req.query);
  res.json(await motorcycleService.listMakes(query));
});

export const getMake = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ make: await motorcycleService.getMake(id) });
});

export const createMake = asyncHandler(async (req: Request, res: Response) => {
  const body = makeCreateSchema.parse(req.body);
  const make = await motorcycleService.createMake(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ make });
});

export const updateMake = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = makeUpdateSchema.parse(req.body);
  const make = await motorcycleService.updateMake(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ make });
});

export const updateMakeStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const make = await motorcycleService.setMakeStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ make });
});

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const listModels = asyncHandler(async (req: Request, res: Response) => {
  const query = modelListQuery.parse(req.query);
  res.json(await motorcycleService.listModels(query));
});

export const getModel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ model: await motorcycleService.getModel(id) });
});

export const createModel = asyncHandler(async (req: Request, res: Response) => {
  const body = modelCreateSchema.parse(req.body);
  const model = await motorcycleService.createModel(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ model });
});

export const updateModel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = modelUpdateSchema.parse(req.body);
  const model = await motorcycleService.updateModel(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ model });
});

export const updateModelStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const model = await motorcycleService.setModelStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ model });
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const listVariants = asyncHandler(async (req: Request, res: Response) => {
  const query = variantListQuery.parse(req.query);
  res.json(await motorcycleService.listVariants(query));
});

export const getVariant = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ variant: await motorcycleService.getVariant(id) });
});

export const createVariant = asyncHandler(async (req: Request, res: Response) => {
  const body = variantCreateSchema.parse(req.body);
  const variant = await motorcycleService.createVariant(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ variant });
});

export const updateVariant = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = variantUpdateSchema.parse(req.body);
  const variant = await motorcycleService.updateVariant(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ variant });
});

export const updateVariantStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const variant = await motorcycleService.setVariantStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ variant });
});