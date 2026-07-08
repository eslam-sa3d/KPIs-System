import { Injectable } from '@nestjs/common';
import { FormDefinition, formDefinitionSchema } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

/**
 * Form lifecycle: draft → published (immutable) → archived.
 * Publishing an edit creates a NEW version so historical submissions keep
 * validating against the schema they were created with.
 */
@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForm(slug: string, definition: unknown, createdById: string) {
    const parsed = this.parseDefinition(definition);

    const existing = await this.prisma.form.findUnique({ where: { slug } });
    if (existing) throw new AppError('CONFLICT', `Form slug "${slug}" is already in use`);

    return this.prisma.form.create({
      data: {
        slug,
        createdById,
        versions: { create: { version: 1, definition: parsed } },
      },
      include: { versions: true },
    });
  }

  async publishNewVersion(formId: string, definition: unknown) {
    const parsed = this.parseDefinition(definition);
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!form) throw AppError.notFound('Form', formId);

    const nextVersion = (form.versions[0]?.version ?? 0) + 1;
    return this.prisma.$transaction([
      this.prisma.formVersion.create({
        data: { formId, version: nextVersion, definition: parsed },
      }),
      this.prisma.form.update({ where: { id: formId }, data: { status: 'published' } }),
    ]);
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
    return { form, version, definition: version.definition as unknown as FormDefinition };
  }

  private parseDefinition(definition: unknown): FormDefinition {
    const result = formDefinitionSchema.safeParse(definition);
    if (!result.success) {
      throw AppError.validation(
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}
