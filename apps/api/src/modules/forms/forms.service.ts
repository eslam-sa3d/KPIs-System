import { Injectable } from '@nestjs/common';
import {
  DEFAULT_FORM_SETTINGS,
  FormDefinition,
  FormListItem,
  FormSettings,
  formDefinitionSchema,
  formSettingsSchema,
} from '@pulse/contracts';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AssetsService } from './assets.service';

/**
 * Form lifecycle: draft → published (immutable versions) → archived.
 * Publishing an edit creates a NEW version so historical submissions keep
 * validating against the schema they were created with.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly rbac: RbacService,
  ) {}

  async createForm(slug: string, definition: unknown, createdById: string) {
    const parsed = this.parseDefinition(definition);

    const existing = await this.prisma.form.findUnique({ where: { slug } });
    if (existing) throw new AppError('CONFLICT', `Form slug "${slug}" is already in use`);

    const form = await this.prisma.form.create({
      data: {
        slug,
        status: 'published',
        settings: DEFAULT_FORM_SETTINGS,
        createdById,
        versions: { create: { version: 1, definition: parsed } },
      },
      include: { versions: true },
    });
    await this.assets.claim(form.id, extractAssetIds(parsed));
    return form;
  }

  async publishNewVersion(formId: string, definition: unknown) {
    const parsed = this.parseDefinition(definition);
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!form) throw AppError.notFound('Form', formId);

    const nextVersion = (form.versions[0]?.version ?? 0) + 1;
    const result = await this.prisma.$transaction([
      this.prisma.formVersion.create({
        data: { formId, version: nextVersion, definition: parsed },
      }),
      this.prisma.form.update({ where: { id: formId }, data: { status: 'published' } }),
    ]);
    await this.assets.claim(formId, extractAssetIds(parsed));
    return result;
  }

  /** Every form (including archived — this is the admin management list;
   *  hiding archived forms here would make "unarchive" unreachable) with its
   *  latest version's title. */
  async listForms(): Promise<FormListItem[]> {
    const forms = await this.prisma.form.findMany({
      orderBy: { createdAt: 'desc' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    return forms.map((form) => {
      const latest = form.versions[0];
      const definition = latest?.definition as unknown as FormDefinition | undefined;
      return {
        id: form.id,
        slug: form.slug,
        status: form.status as FormListItem['status'],
        title: definition?.title ?? form.slug,
        fieldCount: definition?.fields.length ?? 0,
        version: latest?.version ?? 0,
        hasPublicLink: Boolean(form.publicToken),
        settings: this.settingsOf(form.settings),
        folder: form.folder,
        createdAt: form.createdAt.toISOString(),
      };
    });
  }

  async getLatestVersion(formSlug: string) {
    const form = await this.prisma.form.findUnique({
      where: { slug: formSlug },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = form?.versions[0];
    if (!form || !version || form.status === 'archived') {
      throw AppError.notFound('Form', formSlug);
    }
    return {
      form,
      version,
      definition: version.definition as unknown as FormDefinition,
      settings: this.settingsOf(form.settings),
    };
  }

  /** Unguessable-token-gated live export — the practical equivalent of MS Forms' "Open in
   *  Excel": paste this URL into Excel's "Get Data from Web" and refresh anytime. */
  async getByExportToken(token: string) {
    const form = await this.prisma.form.findUnique({
      where: { exportToken: token },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = form?.versions[0];
    if (!form || !version || form.status === 'archived') {
      throw AppError.notFound('Form', 'export link');
    }
    return {
      form,
      version,
      definition: version.definition as unknown as FormDefinition,
      settings: this.settingsOf(form.settings),
    };
  }

  async getByPublicToken(token: string) {
    const form = await this.prisma.form.findUnique({
      where: { publicToken: token },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = form?.versions[0];
    if (!form || !version || form.status === 'archived') {
      throw AppError.notFound('Form', 'public link');
    }
    return {
      form,
      version,
      definition: version.definition as unknown as FormDefinition,
      settings: this.settingsOf(form.settings),
    };
  }

  async updateSettings(formId: string, raw: unknown, actorId: string): Promise<FormSettings> {
    const result = formSettingsSchema.safeParse(raw);
    if (!result.success) {
      throw AppError.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);

    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { settings: result.data } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'form.settings_updated',
          entity: 'Form',
          entityId: formId,
          detail: result.data,
        },
      }),
    ]);
    return result.data;
  }

  /** Enable/rotate or disable the anonymous public fill link. */
  async setShareLink(formId: string, enabled: boolean, actorId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);

    const publicToken = enabled ? randomBytes(24).toString('base64url') : null;
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { publicToken } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: enabled ? 'form.share_link_enabled' : 'form.share_link_disabled',
          entity: 'Form',
          entityId: formId,
        },
      }),
    ]);
    return { publicToken };
  }

  /** Enable/rotate or disable the token-gated live export link (see getByExportToken). */
  async setExportLink(formId: string, enabled: boolean, actorId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);

    const exportToken = enabled ? randomBytes(24).toString('base64url') : null;
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { exportToken } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: enabled ? 'form.export_link_enabled' : 'form.export_link_disabled',
          entity: 'Form',
          entityId: formId,
        },
      }),
    ]);
    return { exportToken };
  }

  /** Restricting a form limits portal view/fill to the creator, collaborators, and forms:manage holders.
   *  The anonymous public link (above) is untouched — it's opt-in and always anonymous regardless. */
  async setRestricted(formId: string, restricted: boolean, actorId: string) {
    await this.getOwnedForm(formId, actorId);
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { restricted } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: restricted ? 'form.restricted_enabled' : 'form.restricted_disabled',
          entity: 'Form',
          entityId: formId,
        },
      }),
    ]);
    return { restricted };
  }

  /** Free-text folder tag for the forms list filter — set to null to clear it. */
  async setFolder(formId: string, folder: string | null, actorId: string) {
    await this.getOwnedForm(formId, actorId);
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { folder } }),
      this.prisma.auditLog.create({
        data: { actorId, action: 'form.folder_set', entity: 'Form', entityId: formId, detail: { folder } },
      }),
    ]);
    return { folder };
  }

  /** Archive a form — hides it from the default list (listForms already
   *  filters status !== 'archived') and closes the public/export links to
   *  further use (getByPublicToken/getByExportToken already reject archived
   *  forms), without touching its submission history. */
  async archiveForm(formId: string, actorId: string) {
    await this.getOwnedForm(formId, actorId);
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { status: 'archived' } }),
      this.prisma.auditLog.create({
        data: { actorId, action: 'form.archived', entity: 'Form', entityId: formId },
      }),
    ]);
    return { status: 'archived' as const };
  }

  async unarchiveForm(formId: string, actorId: string) {
    await this.getOwnedForm(formId, actorId);
    await this.prisma.$transaction([
      this.prisma.form.update({ where: { id: formId }, data: { status: 'published' } }),
      this.prisma.auditLog.create({
        data: { actorId, action: 'form.unarchived', entity: 'Form', entityId: formId },
      }),
    ]);
    return { status: 'published' as const };
  }

  /** Hard delete — cascades to versions/submissions/assets/collaborators.
   *  Blocked once any submission has ever been recorded, mirroring the KPI
   *  module's delete guard: archive instead so response history can't be
   *  silently destroyed. */
  async deleteForm(formId: string, actorId: string) {
    const form = await this.getOwnedForm(formId, actorId);
    const submissionCount = await this.prisma.formSubmission.count({
      where: { formVersion: { formId } },
    });
    if (submissionCount > 0) {
      throw new AppError('CONFLICT', `"${form.slug}" has ${submissionCount} submission(s) — archive it instead`);
    }

    await this.prisma.form.delete({ where: { id: formId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'form.deleted', entity: 'Form', entityId: formId, detail: { slug: form.slug } },
    });
    return null;
  }

  async listCollaborators(formId: string) {
    return this.prisma.formCollaborator.findMany({
      where: { formId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async inviteCollaborator(
    formId: string,
    userId: string,
    canManage: boolean,
    actorId: string,
    canViewResponses = false,
  ) {
    await this.getOwnedForm(formId, actorId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User', userId);

    const collaborator = await this.prisma.formCollaborator.upsert({
      where: { formId_userId: { formId, userId } },
      create: { formId, userId, canManage, canViewResponses, addedById: actorId },
      update: { canManage, canViewResponses },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'form.collaborator_added',
        entity: 'Form',
        entityId: formId,
        detail: { userId, canManage, canViewResponses },
      },
    });
    return collaborator;
  }

  async removeCollaborator(formId: string, userId: string, actorId: string) {
    await this.getOwnedForm(formId, actorId);
    await this.prisma.formCollaborator.deleteMany({ where: { formId, userId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'form.collaborator_removed', entity: 'Form', entityId: formId, detail: { userId } },
    });
    return null;
  }

  /** Loads a form and asserts the actor may manage it: the creator, a canManage
   *  collaborator, or a global forms:manage holder — narrower than forms:write
   *  (which lets anyone create/edit forms) for actions specific to ONE form. */
  private async getOwnedForm(formId: string, actorId: string) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { collaborators: { where: { userId: actorId } } },
    });
    if (!form) throw AppError.notFound('Form', formId);

    const isOwner = form.createdById === actorId;
    const isManagingCollaborator = form.collaborators.some((c) => c.canManage);
    if (isOwner || isManagingCollaborator) return form;

    const granted = await this.rbac.getEffectivePermissions(actorId);
    if (granted.has('forms:manage')) return form;

    throw AppError.forbidden('Only the form owner, a co-owner, or an admin can manage this form');
  }

  /** MS-Forms "copy form": new slug, same latest definition, fresh settings. */
  async duplicate(formId: string, createdById: string) {
    const source = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!source?.versions[0]) throw AppError.notFound('Form', formId);

    const definition = source.versions[0].definition as unknown as FormDefinition;
    const copy = {
      ...definition,
      title: `${definition.title} (copy)`,
    } as unknown as Prisma.InputJsonValue;

    return this.prisma.form.create({
      data: {
        slug: `${source.slug.slice(0, 40)}-copy-${Date.now().toString(36)}`,
        status: 'published',
        settings: DEFAULT_FORM_SETTINGS,
        createdById,
        versions: { create: { version: 1, definition: copy } },
      },
    });
  }

  settingsOf(raw: Prisma.JsonValue | null): FormSettings {
    const parsed = formSettingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : DEFAULT_FORM_SETTINGS;
  }

  private parseDefinition(definition: unknown): FormDefinition {
    const result = formDefinitionSchema.safeParse(definition);
    if (!result.success) {
      throw AppError.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return result.data;
  }
}

/** Every FormAsset id referenced anywhere in a definition — field/option media, page media. */
function extractAssetIds(definition: FormDefinition): string[] {
  const ids = new Set<string>();
  for (const field of definition.fields) {
    if (field.media?.assetId) ids.add(field.media.assetId);
    if ('options' in field) for (const o of field.options) if (o.imageAssetId) ids.add(o.imageAssetId);
    if ('statements' in field) for (const s of field.statements) if (s.imageAssetId) ids.add(s.imageAssetId);
    if (field.type === 'hot_spot') ids.add(field.imageAssetId);
  }
  for (const section of definition.sections ?? []) {
    if (section.media?.assetId) ids.add(section.media.assetId);
  }
  return [...ids];
}
