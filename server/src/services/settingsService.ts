import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';

/**
 * Business settings live in the existing `settings` key/value table. Only an
 * explicit whitelist is readable or writable through the API — technical
 * configuration (database URLs, secrets) never passes through here because
 * it is not stored as settings at all.
 */

export interface Actor {
  id: string;
}

export interface Context {
  request?: Request;
  actor?: Actor;
}

const PUBLIC_DEFAULTS: Record<string, string> = {
  'business.name': 'JM SPAREPARTS',
  'business.address': '',
  'business.phone': '',
  'business.email': '',
  'business.currency': 'TZS',
  'business.timezone': 'Africa/Nairobi',
  'business.receiptFooter': 'Thank you for your business',
};

/** Keys any authenticated user may read (needed for receipts/dashboard). */
export const PUBLIC_KEYS = Object.keys(PUBLIC_DEFAULTS);

function audit(input: {
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  context: Context;
}): void {
  void recordAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.beforeState as never,
    afterState: input.afterState as never,
    request: input.context.request,
    userId: input.context.actor?.id,
  });
}

export async function getPublicSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: PUBLIC_KEYS } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result: Record<string, string> = {};
  for (const key of PUBLIC_KEYS) {
    result[key] = byKey.get(key) ?? PUBLIC_DEFAULTS[key] ?? '';
  }
  return result;
}

export async function updateSettings(
  body: Record<string, string>,
  context: Context,
): Promise<Record<string, string>> {
  const changed: Record<string, { before: string; after: string }> = {};

  await prisma.$transaction(async (tx) => {
    const currentRows = await tx.setting.findMany({
      where: { key: { in: Object.keys(body) } },
      select: { key: true, value: true },
    });
    const currentByKey = new Map(currentRows.map((row) => [row.key, row.value]));

    for (const [key, value] of Object.entries(body)) {
      const before = currentByKey.get(key);
      if (before === value) continue;
      await tx.setting.upsert({
        where: { key },
        create: { key, value, dataType: 'STRING' },
        update: { value },
      });
      changed[key] = { before: before ?? '(unset)', after: value };
    }
  });

  if (Object.keys(changed).length > 0) {
    audit({
      action: AUDIT.SETTINGS_UPDATED,
      entityType: 'Setting',
      entityId: 'business-settings',
      afterState: { changed },
      context,
    });
  }

  return getPublicSettings();
}

/** Convenience accessor for services that need one setting (e.g. receipts). */
export async function getSettingValue(key: string): Promise<string | null> {
  if (!PUBLIC_KEYS.includes(key)) return null;
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? PUBLIC_DEFAULTS[key] ?? null;
}
