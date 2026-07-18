import { PrismaClient } from '@prisma/client';
import { ACTIONS, RESOURCES } from '@pulse/contracts';
import argon2 from 'argon2';

const prisma = new PrismaClient();

/** Seeds the permission catalog, a protected admin role, and the first admin. */
async function main() {
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action },
        update: {},
      });
    }
  }

  const admin = await prisma.role.upsert({
    where: { name: 'admin' },
    create: { name: 'admin', description: 'Full platform access', isSystem: true },
    update: {},
  });

  const allPermissions = await prisma.permission.findMany();
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: admin.id, permissionId: permission.id } },
      create: { roleId: admin.id, permissionId: permission.id },
      update: {},
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@pulse.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  // The seed script runs on every boot (see the Render start command), so a
  // missing override must never silently fall back to a publicly-known
  // password in production — refuse to start instead. Local/dev/CI keep the
  // convenience default so `pnpm db:seed` still works out of the box there.
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SEED_ADMIN_PASSWORD must be set in production — refusing to seed the first admin account with a default, publicly-known password.',
      );
    }
    console.warn('SEED_ADMIN_PASSWORD not set — using the local-dev-only default. Never do this in production.');
  }
  const resolvedPassword = password ?? 'ChangeMe!2026';

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, displayName: 'Platform Admin', passwordHash: await argon2.hash(resolvedPassword) },
    update: {},
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: admin.id } },
    create: { userId: user.id, roleId: admin.id },
    update: {},
  });

  console.log(`Seeded admin ${email}`);

  await seedPerformanceLevels();
}

/** Default 0-5 score bands for the Configuration page's Performance Levels
 *  tab — seeded once, only when the table is completely empty. The seed
 *  script runs on every boot (see the Render start command), and matching
 *  by label (the old behavior) couldn't tell "never seeded" apart from "an
 *  admin deliberately deleted this default" — deleting one just made it
 *  look unseeded again, so it silently reappeared on the next deploy. An
 *  empty-table check has no such ambiguity: any row at all, default or
 *  custom, means an admin has already taken ownership of this list, so the
 *  seed backs off entirely instead of reintroducing anything by label. */
async function seedPerformanceLevels() {
  const alreadyConfigured = (await prisma.performanceLevel.count()) > 0;
  if (alreadyConfigured) return;
  await prisma.performanceLevel.createMany({
    data: [
      { label: 'Outstanding', minScore: 4.0, maxScore: 5.0 },
      { label: 'Meets Expectations', minScore: 2.0, maxScore: 3.9 },
      { label: 'Need Improvement', minScore: 1.1, maxScore: 1.9 },
      { label: 'Below Expectations', minScore: 0, maxScore: 1.0 },
    ],
  });
  console.log('Seeded default performance levels');
}

main().finally(() => prisma.$disconnect());
