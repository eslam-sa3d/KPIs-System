import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandingController } from './branding.controller';

/** Previously zero test coverage on this module. Unit tests with a stubbed
 *  Prisma, matching the pattern used across the API test suite — the
 *  controller holds its own logic directly (no separate service). */
function makePrismaStub() {
  return {
    brandSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

describe('BrandingController', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let controller: BrandingController;

  beforeEach(() => {
    prisma = makePrismaStub();
    controller = new BrandingController(prisma as never);
  });

  describe('get', () => {
    it('returns the default identity when nothing has been customized', async () => {
      prisma.brandSetting.findUnique.mockResolvedValue(null);

      const identity = await controller.get();

      expect(identity).toEqual({
        companyName: 'pulse by solutions',
        headline: 'elevating what matters',
        tagline: 'the intelligence behind what can’t fail',
      });
    });

    it('returns the stored identity once customized', async () => {
      const custom = { companyName: 'Acme', headline: 'go fast', tagline: 'ship it' };
      prisma.brandSetting.findUnique.mockResolvedValue({ key: 'identity', value: custom });

      const identity = await controller.get();

      expect(identity).toEqual(custom);
    });
  });

  describe('update', () => {
    it('upserts the identity and audit-logs the change', async () => {
      const next = { companyName: 'Acme', headline: 'go fast', tagline: 'ship it' };

      const result = await controller.update(next, { user: { id: 'admin-1' } });

      expect(prisma.brandSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'identity' },
        create: { key: 'identity', value: next },
        update: { value: next },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'admin-1',
          action: 'branding.updated',
          entity: 'BrandSetting',
          entityId: 'identity',
          detail: next,
        }),
      });
      expect(result).toEqual(next);
    });
  });
});
