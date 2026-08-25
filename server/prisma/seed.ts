import { hash } from 'bcryptjs';

import { PrismaClient, UserRole, DocumentType } from '@prisma/client';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

// Dev-only defaults. NEVER use these passwords in production. They satisfy the
// password policy (>= 8 chars, letter + number) so login works after seeding.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@jmspareparts.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Makire123';
const ASSISTANT_EMAIL = process.env.SEED_ASSISTANT_EMAIL ?? 'assistant@jmspareparts.local';
const ASSISTANT_PASSWORD = process.env.SEED_ASSISTANT_PASSWORD ?? 'Shop12345';

// Emails used by earlier seeds; renamed in place so existing dev databases
// keep the same user rows.
const LEGACY_ADMIN_EMAILS = ['admin@makire-motorparts.local', 'admin@makire.local'];
const LEGACY_ASSISTANT_EMAILS = [
  'assistant@makire-motorparts.local',
  'assistant@makire.local',
];

async function main(): Promise<void> {
  const adminPasswordHash = await hash(ADMIN_PASSWORD, BCRYPT_COST);
  const assistantPasswordHash = await hash(ASSISTANT_PASSWORD, BCRYPT_COST);

  // Rename legacy long-email accounts if present, so re-seeding an existing
  // dev database keeps the same user rows (audit history stays attached).
  const admin =
    (await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })) ??
    (await prisma.user.findFirst({ where: { email: { in: LEGACY_ADMIN_EMAILS } } }));
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { email: ADMIN_EMAIL, passwordHash: adminPasswordHash },
    });
  } else {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        fullName: 'System Administrator',
        passwordHash: adminPasswordHash,
        role: UserRole.ADMIN,
      },
    });
  }

  const assistant =
    (await prisma.user.findUnique({ where: { email: ASSISTANT_EMAIL } })) ??
    (await prisma.user.findFirst({ where: { email: { in: LEGACY_ASSISTANT_EMAILS } } }));
  if (assistant) {
    await prisma.user.update({
      where: { id: assistant.id },
      data: { email: ASSISTANT_EMAIL, passwordHash: assistantPasswordHash },
    });
  } else {
    await prisma.user.create({
      data: {
        email: ASSISTANT_EMAIL,
        fullName: 'Shop Assistant',
        passwordHash: assistantPasswordHash,
        role: UserRole.ASSISTANT,
      },
    });
  }

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