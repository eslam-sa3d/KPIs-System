import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { FORM_PERMISSION_KEY, FormPermissionAction } from './form-permission.decorator';

/**
 * Two independent, form-scoped access decisions, both registered globally
 * (like PermissionsGuard) so every form-scoped route is covered without
 * decorating each one — a fast no-op for the vast majority of forms and
 * routes that don't need either check:
 *
 * 1. Restricted forms: narrows portal view/fill access beyond the coarse
 *    forms:read/forms:write RBAC check PermissionsGuard already ran.
 *
 * 2. @FormPermission('view' | 'manage'): the response-read/manage routes
 *    (list, summary, exports, edit, delete). Access is granted by global
 *    RBAC (form_submissions:read/manage), form ownership, or the matching
 *    FormCollaborator tier (canViewResponses for 'view', canManage for
 *    either) — replaces the blanket @RequirePermissions('form_submissions:*')
 *    those routes used to carry, since PermissionsGuard's AND-combined chain
 *    can't express "granted by any ONE of several different things."
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
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const params: Record<string, string> = req.params ?? {};
    const identifier = params.slug ?? params.formId;
    if (!identifier) return true; // not a per-form route

    const user = req.user as { id: string } | undefined;
    if (!user) return true; // unauthenticated — JwtAuthGuard/PermissionsGuard already gate this

    const action = this.reflector.getAllAndOverride<FormPermissionAction | undefined>(FORM_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const form = params.slug
      ? await this.prisma.form.findUnique({
          where: { slug: identifier },
          select: { id: true, restricted: true, createdById: true },
        })
      : await this.prisma.form.findUnique({
          where: { id: identifier },
          select: { id: true, restricted: true, createdById: true },
        });
    if (!form) return true; // unknown id — normal RBAC / 404 handling covers it

    const isOwner = form.createdById === user.id;
    const collaborator =
      form.restricted || action
        ? await this.prisma.formCollaborator.findUnique({
            where: { formId_userId: { formId: form.id, userId: user.id } },
          })
        : null;

    if (form.restricted && !isOwner && !collaborator) {
      const granted = await this.rbac.getEffectivePermissions(user.id);
      if (!granted.has('forms:manage')) {
        throw AppError.forbidden('This form is restricted to specific people');
      }
    }

    if (action) {
      if (isOwner || collaborator?.canManage) return true;
      if (action === 'view' && collaborator?.canViewResponses) return true;
      const granted = await this.rbac.getEffectivePermissions(user.id);
      const required = action === 'manage' ? 'form_submissions:manage' : 'form_submissions:read';
      if (!granted.has(required)) {
        throw AppError.forbidden(`Missing permission to ${action} this form's responses`);
      }
    }

    return true;
  }
}
