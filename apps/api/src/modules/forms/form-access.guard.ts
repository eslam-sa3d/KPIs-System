import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RbacService } from '../rbac/rbac.service';

/**
 * Narrows access to a RESTRICTED form beyond the coarse forms:read/forms:write
 * RBAC check PermissionsGuard already ran. Registered globally (like
 * PermissionsGuard) so every form-scoped route is covered without decorating
 * each one — it's a fast no-op for the vast majority of forms, which aren't
 * restricted, and for routes that aren't form-scoped at all.
 *
 * Deliberately does NOT touch the anonymous public-link routes
 * (PublicFormsController) — those are @Public() and never reach this guard
 * (JwtAuthGuard lets them through with no req.user), by design: enabling
 * "restricted" narrows who can use the portal, it doesn't retract an
 * already-anonymous share link.
 */
@Injectable()
export class FormAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const params: Record<string, string> = req.params ?? {};
    const identifier = params.slug ?? params.formId;
    if (!identifier) return true; // not a per-form route

    const user = req.user as { id: string } | undefined;
    if (!user) return true; // unauthenticated — JwtAuthGuard/PermissionsGuard already gate this

    const form = params.slug
      ? await this.prisma.form.findUnique({
          where: { slug: identifier },
          select: { id: true, restricted: true, createdById: true },
        })
      : await this.prisma.form.findUnique({
          where: { id: identifier },
          select: { id: true, restricted: true, createdById: true },
        });
    if (!form || !form.restricted) return true; // unknown id or not restricted — normal RBAC covers it
    if (form.createdById === user.id) return true;

    const collaborator = await this.prisma.formCollaborator.findUnique({
      where: { formId_userId: { formId: form.id, userId: user.id } },
    });
    if (collaborator) return true;

    const granted = await this.rbac.getEffectivePermissions(user.id);
    if (granted.has('forms:manage')) return true;

    throw AppError.forbidden('This form is restricted to specific people');
  }
}
