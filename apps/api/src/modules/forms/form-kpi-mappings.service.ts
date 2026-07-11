import { Injectable } from '@nestjs/common';
import type { FormKpiMapping as PrismaFormKpiMapping } from '@prisma/client';
import {
  BulkCreateFormKpiMappingInput,
  BulkCreateFormKpiMappingResult,
  CreateFormKpiMappingInput,
  SCORE_FIELD_TYPES,
} from '@pulse/contracts';
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

    if (input.evaluateeFieldKey) {
      const evaluateeField = definition.fields.find((f) => f.key === input.evaluateeFieldKey);
      if (!evaluateeField || evaluateeField.type !== 'person') {
        throw AppError.validation([
          { path: 'evaluateeFieldKey', message: 'must reference a "person" field on this form' },
        ]);
      }
    }
    const scoreField = definition.fields.find((f) => f.key === input.scoreFieldKey);
    if (!scoreField || !(SCORE_FIELD_TYPES as readonly string[]).includes(scoreField.type)) {
      throw AppError.validation([
        { path: 'scoreFieldKey', message: `must reference a scoreable field on this form (${SCORE_FIELD_TYPES.join(', ')})` },
      ]);
    }
    this.validateExtraFieldKeys(definition, input.contextFieldKey, input.commentFieldKey);

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
        reviewType: input.reviewType,
        anonymous: input.anonymous,
        contextFieldKey: input.contextFieldKey,
        commentFieldKey: input.commentFieldKey,
      },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'form_kpi_mapping.created', entity: 'FormKpiMapping', entityId: mapping.id, detail: input },
    });
    return mapping;
  }

  /** contextFieldKey/commentFieldKey are optional and deliberately untyped
   *  (any field type can supply free-text context) — the only real
   *  requirement is that they exist on the form at all. */
  private validateExtraFieldKeys(
    definition: { fields: Array<{ key: string }> },
    contextFieldKey: string | undefined,
    commentFieldKey: string | undefined,
  ) {
    const errors: Array<{ path: string; message: string }> = [];
    if (contextFieldKey && !definition.fields.some((f) => f.key === contextFieldKey)) {
      errors.push({ path: 'contextFieldKey', message: 'must reference a field on this form' });
    }
    if (commentFieldKey && !definition.fields.some((f) => f.key === commentFieldKey)) {
      errors.push({ path: 'commentFieldKey', message: 'must reference a field on this form' });
    }
    if (errors.length > 0) throw AppError.validation(errors);
  }

  /**
   * Maps many questions on one form in a single call, sharing one evaluatee
   * field across all of them (the normal shape of a multi-question
   * evaluation survey). Each row is validated and persisted independently —
   * a row referencing an already-mapped Evaluation Area, an unknown area, or
   * a field that isn't a valid score field is skipped with a reason rather
   * than failing the whole batch, so re-running this against a form that's
   * already partially mapped only fills in the gaps.
   */
  async bulkCreate(formId: string, input: BulkCreateFormKpiMappingInput, actorId: string) {
    const { definition } = await this.forms.getLatestVersion((await this.requireForm(formId)).slug);

    if (input.evaluateeFieldKey) {
      const evaluateeField = definition.fields.find((f) => f.key === input.evaluateeFieldKey);
      if (!evaluateeField || evaluateeField.type !== 'person') {
        throw AppError.validation([
          { path: 'evaluateeFieldKey', message: 'must reference a "person" field on this form' },
        ]);
      }
    }
    this.validateExtraFieldKeys(definition, input.contextFieldKey, input.commentFieldKey);

    // Raw Prisma rows (createdAt: Date) — serialized to the wire-format
    // BulkCreateFormKpiMappingResult (createdAt: string) by Nest's response
    // pipeline, same as every other Prisma-returning handler in this module.
    const result: { created: PrismaFormKpiMapping[]; skipped: BulkCreateFormKpiMappingResult['skipped'] } = {
      created: [],
      skipped: [],
    };

    for (const row of input.mappings) {
      const scoreField = definition.fields.find((f) => f.key === row.scoreFieldKey);
      if (!scoreField || !(SCORE_FIELD_TYPES as readonly string[]).includes(scoreField.type)) {
        result.skipped.push({
          evaluationAreaId: row.evaluationAreaId,
          reason: `"${row.scoreFieldKey}" must be a scoreable field (${SCORE_FIELD_TYPES.join(', ')})`,
        });
        continue;
      }

      const area = await this.prisma.evaluationArea.findUnique({ where: { id: row.evaluationAreaId } });
      if (!area) {
        result.skipped.push({ evaluationAreaId: row.evaluationAreaId, reason: 'evaluation area not found' });
        continue;
      }

      const existing = await this.prisma.formKpiMapping.findUnique({
        where: { formId_evaluationAreaId: { formId, evaluationAreaId: row.evaluationAreaId } },
      });
      if (existing) {
        result.skipped.push({
          evaluationAreaId: row.evaluationAreaId,
          reason: `this form is already mapped to "${area.name}"`,
        });
        continue;
      }

      const mapping = await this.prisma.formKpiMapping.create({
        data: {
          formId,
          evaluationAreaId: row.evaluationAreaId,
          evaluateeFieldKey: input.evaluateeFieldKey,
          scoreFieldKey: row.scoreFieldKey,
          reviewType: input.reviewType,
          anonymous: input.anonymous,
          contextFieldKey: input.contextFieldKey,
          commentFieldKey: input.commentFieldKey,
        },
      });
      result.created.push(mapping);
    }

    if (result.created.length > 0) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'form_kpi_mapping.bulk_created',
          entity: 'FormKpiMapping',
          entityId: formId,
          detail: { evaluateeFieldKey: input.evaluateeFieldKey, count: result.created.length },
        },
      });
    }

    return result;
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
