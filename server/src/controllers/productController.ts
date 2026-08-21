import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  productCreateSchema,
  productListQuery,
  productUpdateSchema,
  statusUpdateSchema,
} from '../validators/catalog.js';
import * as productService from '../services/productService.js';

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = productListQuery.parse(req.query);
  res.json(await productService.listProducts(query));
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ product: await productService.getProduct(id) });
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = productCreateSchema.parse(req.body);
  const product = await productService.createProduct(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = productUpdateSchema.parse(req.body);
  const product = await productService.updateProduct(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ product });
});

export const updateProductStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = statusUpdateSchema.parse(req.body);
  const product = await productService.setProductStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ product });
});