import type { Request, Response } from 'express';

import * as supplierService from '../services/supplierService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  supplierCreateSchema,
  supplierListQuery,
  supplierProductLinkSchema,
  supplierProductUpdateSchema,
  supplierStatusSchema,
  supplierUpdateSchema,
} from '../validators/purchasing.js';

export const listSuppliers = asyncHandler(async (req: Request, res: Response) => {
  const query = supplierListQuery.parse(req.query);
  res.json(await supplierService.listSuppliers(query));
});

export const getSupplier = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ supplier: await supplierService.getSupplier(id) });
});

export const createSupplier = asyncHandler(async (req: Request, res: Response) => {
  const body = supplierCreateSchema.parse(req.body);
  const supplier = await supplierService.createSupplier(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ supplier });
});

export const updateSupplier = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = supplierUpdateSchema.parse(req.body);
  const supplier = await supplierService.updateSupplier(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ supplier });
});

export const updateSupplierStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = supplierStatusSchema.parse(req.body);
  const supplier = await supplierService.setSupplierStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ supplier });
});

export const listSupplierProducts = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const status = req.query.status === 'INACTIVE' ? 'INACTIVE' : req.query.status === 'ALL' ? undefined : 'ACTIVE';
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const products = await supplierService.listSupplierProducts(id, { status: status as never, q });
  res.json({ products });
});

export const linkSupplierProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = supplierProductLinkSchema.parse(req.body);
  const link = await supplierService.linkSupplierProduct(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ supplierProduct: link });
});

export const updateSupplierProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = supplierProductUpdateSchema.parse(req.body);
  const link = await supplierService.updateSupplierProduct(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ supplierProduct: link });
});

export const unlinkSupplierProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const result = await supplierService.unlinkSupplierProduct(id, {
    request: req,
    actor: requireActor(req),
  });
  res.json(result);
});