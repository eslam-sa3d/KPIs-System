import { Injectable } from '@nestjs/common';
import { CreateFormKpiMappingInput, SCORE_FIELD_TYPES } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { FormsService } from './forms.service';

/**
 * Admin CRUD for the Forms→KPI bridge: which of a form's own fields supplies
 * the evaluatee and which supplies the score, for a given Evaluation Area.
 * SubmissionsService reads these rows at submit time — see its persist().
 */
@Injectable()
export class FormKpiMappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  async list(formId: string) {
    return this.prisma.formKpiMapping.findMany({
      where: { formId },
      include: { evaluationArea: { select: { id: true, name: true, kpiId: true, cadence: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(formId: string, input: CreateFormKpiMappingInput, actorId: string) {
    const { definition } = await this.forms.getLatestVersion((await this.requireForm(formId)).slug);

    const evaluateeField = definition.fields.find((f) => f.key === input.evaluateeFieldKey);
    if (!evaluateeField || evaluateeField.type !== 'person') {
      throw AppError.validation([
        { path: 'evaluateeFieldKey', message: 'must reference a "person" field on this form' },
      ]);
    }
    const scoreField = definition.fields.find((f) => f.key === input.scoreFieldKey);
    if (!scoreField || !(SCORE_FIELD_TYPES as readonly string[]).includes(scoreField.type)) {
      throw AppError.validation([
        { path: 'scoreFieldKey', message: 'must reference a rating, nps, or slider field on this form' },
      ]);
    }

    const area = await this.prisma.evaluationArea.findUnique({ where: { id: input.evaluationAreaId } });
    if (!area) throw AppError.notFound('Evaluation area', input.evaluationAreaId);

    const existing = await this.prisma.formKpiMapping.findUnique({
      where: { formId_evaluationAreaId: { formId, evaluationAreaId: input.evaluationAreaId } },
    });
    if (existing) {
      throw new AppError('CONFLICT', `This form is already mapped to "${area.name}"`);
    }

    const mapping = await this.prisma.formKpiMapping.create({
      data: {
        formId,
        evaluationAreaId: input.evaluationAreaId,
        evaluateeFieldKey: input.evaluateeFieldKey,
        scoreFieldKey: input.scoreFieldKey,
      },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'form_kpi_mapping.created', entity: 'FormKpiMapping', entityId: mapping.id, detail: input },
    });
    return mapping;
  }

  async delete(formId: string, mappingId: string, actorId: string) {
    await this.requireForm(formId);
    const mapping = await this.prisma.formKpiMapping.findFirst({ where: { id: mappingId, formId } });
    if (!mapping) throw AppError.notFound('Form KPI mapping', mappingId);

    await this.prisma.formKpiMapping.delete({ where: { id: mappingId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'form_kpi_mapping.deleted', entity: 'FormKpiMapping', entityId: mappingId },
    });
    return null;
  }

  private async requireForm(formId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);
    return form;
  }
}
