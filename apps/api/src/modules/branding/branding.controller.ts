import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { BrandIdentity, brandIdentitySchema } from '@pulse/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';

const IDENTITY_KEY = 'identity';

const DEFAULT_IDENTITY: BrandIdentity = {
  companyName: 'pulse by solutions',
  headline: 'elevating what matters',
  tagline: 'the intelligence behind what can’t fail',
};

/**
 * Customizable company identity (pillar 5): the landing page and portal chrome
 * read it publicly; admins update it without a deployment.
 */
@Controller('v1/branding')
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async get(): Promise<BrandIdentity> {
    const setting = await this.prisma.brandSetting.findUnique({ where: { key: IDENTITY_KEY } });
    return setting ? (setting.value as unknown as BrandIdentity) : DEFAULT_IDENTITY;
  }

  @Put()
  @RequirePermissions('branding:write')
  async update(
    @Body(new ZodValidationPipe(brandIdentitySchema)) identity: BrandIdentity,
    @Req() req: { user: { id: string } },
  ): Promise<BrandIdentity> {
    await this.prisma.brandSetting.upsert({
      where: { key: IDENTITY_KEY },
      create: { key: IDENTITY_KEY, value: identity },
      update: { value: identity },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: 'branding.updated',
        entity: 'BrandSetting',
        entityId: IDENTITY_KEY,
        detail: identity,
      },
    });
    return identity;
  }
}
