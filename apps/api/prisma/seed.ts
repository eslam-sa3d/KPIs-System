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
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, displayName: 'Platform Admin', passwordHash: await argon2.hash(password) },
    update: {},
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: admin.id } },
    create: { userId: user.id, roleId: admin.id },
    update: {},
  });

  console.log(`Seeded admin ${email}`);
}

main().finally(() => prisma.$disconnect());
