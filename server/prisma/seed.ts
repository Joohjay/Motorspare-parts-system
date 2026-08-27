import { hash } from 'bcryptjs';

import { Prisma, PrismaClient, UserRole, DocumentType } from '@prisma/client';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

// Dev-only defaults. NEVER use these passwords in production. They satisfy the
// password policy (>= 8 chars, letter + number) so login works after seeding.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@jmspareparts.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Makire123';
const ASSISTANT_EMAIL = process.env.SEED_ASSISTANT_EMAIL ?? 'assistant@jmspareparts.local';
const ASSISTANT_PASSWORD = process.env.SEED_ASSISTANT_PASSWORD ?? 'Shop12345';

// Set SEED_RESET_PASSWORDS=1 only when you FORGOT a password and want the seed
// to reset it back to the dev default. By default existing accounts keep the
// passwords the user chose — the seed never silently overwrites credentials.
const SEED_RESET_PASSWORDS = ['1', 'true', 'yes'].includes(
  (process.env.SEED_RESET_PASSWORDS ?? '').toLowerCase(),
);

// Emails used by earlier seeds; renamed in place so existing dev databases
// keep the same user rows.
const LEGACY_ADMIN_EMAILS = ['admin@makire-motorparts.local', 'admin@makire.local'];
const LEGACY_ASSISTANT_EMAILS = [
  'assistant@makire-motorparts.local',
  'assistant@makire.local',
];

async function ensureUser(opts: {
  email: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
  legacyEmails: string[];
}): Promise<void> {
  const existing =
    (await prisma.user.findUnique({ where: { email: opts.email } })) ??
    (await prisma.user.findFirst({ where: { email: { in: opts.legacyEmails } } }));

  if (existing) {
    // Rename legacy long-email accounts in place so audit history stays
    // attached, but NEVER touch the credentials the user chose.
    const data: Prisma.UserUpdateInput = {};
    if (existing.email !== opts.email) data.email = opts.email;
    if (SEED_RESET_PASSWORDS) data.passwordHash = opts.passwordHash;
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: existing.id }, data });
    }
    const note = SEED_RESET_PASSWORDS
      ? 'password reset to seed default'
      : 'password unchanged';
    console.log(`  EXISTING ${opts.role}: ${opts.email} (${note})`);
    return;
  }

  await prisma.user.create({
    data: {
      email: opts.email,
      fullName: opts.fullName,
      passwordHash: opts.passwordHash,
      role: opts.role,
    },
  });
  console.log(`  CREATED ${opts.role}: ${opts.email}`);
}

async function main(): Promise<void> {
  const adminPasswordHash = await hash(ADMIN_PASSWORD, BCRYPT_COST);
  const assistantPasswordHash = await hash(ASSISTANT_PASSWORD, BCRYPT_COST);

  await ensureUser({
    email: ADMIN_EMAIL,
    fullName: 'System Administrator',
    passwordHash: adminPasswordHash,
    role: UserRole.ADMIN,
    legacyEmails: LEGACY_ADMIN_EMAILS,
  });

  await ensureUser({
    email: ASSISTANT_EMAIL,
    fullName: 'Shop Assistant',
    passwordHash: assistantPasswordHash,
    role: UserRole.ASSISTANT,
    legacyEmails: LEGACY_ASSISTANT_EMAILS,
  });

  const sequences = Object.values(DocumentType).map((documentType) => ({
    documentType,
    prefix: documentType,
    lastNumber: 0,
    padLength: 6,
  }));

  for (const sequence of sequences) {
    await prisma.documentSequence.upsert({
      where: { documentType: sequence.documentType },
      update: {},
      create: sequence,
    });
  }

  const settings = [
    { key: 'business.name', value: 'JM SPAREPARTS', dataType: 'STRING' },
    { key: 'business.currency', value: 'TZS', dataType: 'STRING' },
    { key: 'business.phone', value: '', dataType: 'STRING' },
    { key: 'business.address', value: '', dataType: 'STRING' },
    { key: 'business.receiptFooter', value: 'Thank you for shopping with JM SPAREPARTS', dataType: 'STRING' },
    { key: 'inventory.lowStockThreshold', value: '5', dataType: 'NUMBER' },
  ] as const;

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: { ...setting, value: String(setting.value) },
    });
  }

  console.log('Seed complete');
  console.log(`  ADMIN:    ${ADMIN_EMAIL} (dev only)`);
  console.log(`  ASSISTANT: ${ASSISTANT_EMAIL} (dev only)`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });