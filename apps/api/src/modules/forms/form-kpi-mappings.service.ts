import { Injectable } from '@nestjs/common';
import type { FormKpiMapping as PrismaFormKpiMapping } from '@prisma/client';
import {
  BulkCreateFormKpiMappingInput,
  BulkCreateFormKpiMappingResult,
  CreateFormKpiMappingInput,
  FormDefinition,
  isEvaluateeField,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { DASHBOARD_CACHE_GENERATION_KEY } from '../kpis/kpi-dashboard.service';
import { FormsService } from './forms.service';

/**
 * Admin CRUD for the Forms→KPI bridge: which of a form's own fields supplies
 * the evaluatee and which supplies the score, for a given Evaluation Area.
 * FormKpiScoringService reads these rows at submit time — see its applyKpiMappings().
 */
@Injectable()
export class FormKpiMappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly redis: RedisService,
  ) {}

  /** loadScoredSubmissions (kpi-dashboard.service.ts) re-derives scoring from
   *  the CURRENT mapping set against every existing submission on each call —
   *  no backfill needed for a mapping change to take effect — so create/
   *  update/delete here must invalidate the dashboard cache same as a
   *  submission write. Best-effort: see kpi-dashboard.service.ts's
   *  cachedDashboardRead. */
  private async invalidateDashboardCache(): Promise<void> {
    try {
      await this.redis.incr(DASHBOARD_CACHE_GENERATION_KEY);
    } catch {
      // fail-open — the dashboard's own short TTL bounds staleness regardless.
    }
  }

  async list(formId: string) {
    return this.prisma.formKpiMapping.findMany({
      where: { formId },
      include: {
        evaluationArea: { select: { id: true, name: true, kpiId: true, cadence: true } },
        subCriteria: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(formId: string, input: CreateFormKpiMappingInput, actorId: string) {
    const { definition } = await this.forms.getLatestVersion((await this.requireForm(formId)).slug);

    this.validateEvaluateeFieldKeys(definition, input.evaluateeFieldKeys);
    // Any answerable field can be linked — see normalizeScore in FormKpiScoringService for which
    // types (SCORE_FIELD_TYPES) actually produce a live score; the rest just never do, silently.
    const scoreField = definition.fields.find((f) => f.key === input.scoreFieldKey);
    if (!scoreField || scoreField.type === 'section_header') {
      throw AppError.validation([{ path: 'scoreFieldKey', message: 'must reference a question on this form' }]);
    }
    this.validateExtraFieldKeys(definition, input.contextFieldKey, input.commentFieldKey);

    const area = await this.prisma.evaluationArea.findUnique({ where: { id: input.evaluationAreaId } });
    if (!area) throw AppError.notFound('Evaluation area', input.evaluationAreaId);

    if (input.subCriteriaId) {
      await this.requireSubCriteriaInArea(input.subCriteriaId, input.evaluationAreaId);
    }

    // findFirst, not findUnique: subCriteriaId is nullable, and Prisma's compound
    // WhereUniqueInput type doesn't accept `null` for a nullable key component.
    const existing = await this.prisma.formKpiMapping.findFirst({
      where: { formId, evaluationAreaId: input.evaluationAreaId, subCriteriaId: input.subCriteriaId ?? null },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        input.subCriteriaId
          ? `This form is already mapped to "${area.name}" under that sub-criteria`
          : `This form is already mapped to "${area.name}" with no sub-criteria`,
      );
    }

    const mapping = await this.prisma.formKpiMapping.create({
      data: {
        formId,
        evaluationAreaId: input.evaluationAreaId,
        subCriteriaId: input.subCriteriaId,
        evaluateeFieldKeys: input.evaluateeFieldKeys ?? [],
        scoreFieldKey: input.scoreFieldKey,
        reviewType: input.reviewType,
        anonymous: input.anonymous,
        contextFieldKey: input.contextFieldKey,
        commentFieldKey: input.commentFieldKey,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'form_kpi_mapping.created',
        entity: 'FormKpiMapping',
        entityId: mapping.id,
        detail: input,
      },
    });
    await this.invalidateDashboardCache();
    return mapping;
  }

  /** A mapping's subCriteriaId must actually belong to the Evaluation Area
   *  it's mapped to — otherwise the "narrows the area" tag would silently
   *  point at an unrelated part of the KPI tree. */
  /** Same validation as create(), against an existing row — lets an admin fix a
   *  mapping's evaluatee fields (the common case that used to require delete +
   *  recreate + backfill) or any other field without losing its id/createdAt/
   *  audit trail. The uniqueness check only re-runs when evaluationAreaId or
   *  subCriteriaId is actually changing, since the existing row would
   *  otherwise "conflict with itself". */
  async update(formId: string, mappingId: string, input: CreateFormKpiMappingInput, actorId: string) {
    const form = await this.requireForm(formId);
    const existing = await this.prisma.formKpiMapping.findFirst({ where: { id: mappingId, formId } });
    if (!existing) throw AppError.notFound('Form KPI mapping', mappingId);

    const { definition } = await this.forms.getLatestVersion(form.slug);
    this.validateEvaluateeFieldKeys(definition, input.evaluateeFieldKeys);
    const scoreField = definition.fields.find((f) => f.key === input.scoreFieldKey);
    if (!scoreField || scoreField.type === 'section_header') {
      throw AppError.validation([{ path: 'scoreFieldKey', message: 'must reference a question on this form' }]);
    }
    this.validateExtraFieldKeys(definition, input.contextFieldKey, input.commentFieldKey);

    const area = await this.prisma.evaluationArea.findUnique({ where: { id: input.evaluationAreaId } });
    if (!area) throw AppError.notFound('Evaluation area', input.evaluationAreaId);

    if (input.subCriteriaId) {
      await this.requireSubCriteriaInArea(input.subCriteriaId, input.evaluationAreaId);
    }

    const nextSubCriteriaId = input.subCriteriaId ?? null;
    if (input.evaluationAreaId !== existing.evaluationAreaId || nextSubCriteriaId !== existing.subCriteriaId) {
      // findFirst, not findUnique — same nullable-key reason as create() above.
      const conflict = await this.prisma.formKpiMapping.findFirst({
        where: { formId, evaluationAreaId: input.evaluationAreaId, subCriteriaId: nextSubCriteriaId },
      });
      if (conflict) {
        throw new AppError(
          'CONFLICT',
          nextSubCriteriaId
            ? `This form is already mapped to "${area.name}" under that sub-criteria`
            : `This form is already mapped to "${area.name}" with no sub-criteria`,
        );
      }
    }

    const mapping = await this.prisma.formKpiMapping.update({
      where: { id: mappingId },
      data: {
        evaluationAreaId: input.evaluationAreaId,
        // ?? null (not undefined) for every optional field — Prisma's update
        // treats an undefined field as "leave it alone", so clearing a
        // previously-set value in the edit form has to be an explicit null.
        subCriteriaId: input.subCriteriaId ?? null,
        evaluateeFieldKeys: input.evaluateeFieldKeys ?? [],
        scoreFieldKey: input.scoreFieldKey,
        reviewType: input.reviewType,
        anonymous: input.anonymous,
        contextFieldKey: input.contextFieldKey ?? null,
        commentFieldKey: input.commentFieldKey ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'form_kpi_mapping.updated',
        entity: 'FormKpiMapping',
        entityId: mapping.id,
        detail: input,
      },
    });
    await this.invalidateDashboardCache();
    return mapping;
  }

  private async requireSubCriteriaInArea(subCriteriaId: string, evaluationAreaId: string): Promise<void> {
    const subCriteria = await this.prisma.subCriteria.findUnique({ where: { id: subCriteriaId } });
    if (!subCriteria || subCriteria.evaluationAreaId !== evaluationAreaId) {
      throw AppError.validation([
        { path: 'subCriteriaId', message: 'must reference a sub-criteria under the selected evaluation area' },
      ]);
    }
  }

  /** Every candidate in evaluateeFieldKeys must independently be a valid
   *  evaluatee field — a 'person' field, or a 'select' field with at least
   *  one user-linked option (see isEvaluateeField). */
  private validateEvaluateeFieldKeys(definition: FormDefinition, evaluateeFieldKeys: string[] | undefined) {
    for (const key of evaluateeFieldKeys ?? []) {
      const field = definition.fields.find((f) => f.key === key);
      if (!field || !isEvaluateeField(field)) {
        throw AppError.validation([
          {
            path: 'evaluateeFieldKeys',
            message: `"${key}" must reference a "person" field, or a "select" field with at least one user-linked option`,
          },
        ]);
      }
    }
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

    this.validateEvaluateeFieldKeys(definition, input.evaluateeFieldKeys);
    this.validateExtraFieldKeys(definition, input.contextFieldKey, input.commentFieldKey);

    // Raw Prisma rows (createdAt: Date) — serialized to the wire-format
    // BulkCreateFormKpiMappingResult (createdAt: string) by Nest's response
    // pipeline, same as every other Prisma-returning handler in this module.
    const result: { created: PrismaFormKpiMapping[]; skipped: BulkCreateFormKpiMappingResult['skipped'] } = {
      created: [],
      skipped: [],
    };

    // Batched upfront instead of a findUnique-per-row inside the loop below —
    // up to 200 rows per call (bulkCreateFormKpiMappingSchema's cap), so this
    // turns up to 2×200 sequential round trips into 2.
    const areaIds = [...new Set(input.mappings.map((row) => row.evaluationAreaId))];
    const [areas, existingMappings] = await Promise.all([
      this.prisma.evaluationArea.findMany({ where: { id: { in: areaIds } } }),
      this.prisma.formKpiMapping.findMany({ where: { formId, evaluationAreaId: { in: areaIds } } }),
    ]);
    const areaById = new Map(areas.map((area) => [area.id, area]));
    // Tracks both pre-existing mappings and ones created earlier in this same
    // batch — a row can't be re-checked against the DB mid-loop anymore, so
    // this set is updated by hand right after each create() below, mirroring
    // the read-your-own-writes behavior the old per-row findUnique gave for free.
    // A bulk-created row never sets subCriteriaId (no such input here), so it
    // only conflicts with an existing mapping that's ALSO untagged — one
    // already narrowed to a specific sub-criteria doesn't block it.
    const mappedAreaIds = new Set(
      existingMappings.filter((m) => m.subCriteriaId === null).map((m) => m.evaluationAreaId),
    );

    for (const row of input.mappings) {
      const scoreField = definition.fields.find((f) => f.key === row.scoreFieldKey);
      if (!scoreField || scoreField.type === 'section_header') {
        result.skipped.push({
          evaluationAreaId: row.evaluationAreaId,
          reason: `"${row.scoreFieldKey}" must reference a question on this form`,
        });
        continue;
      }

      const area = areaById.get(row.evaluationAreaId);
      if (!area) {
        result.skipped.push({ evaluationAreaId: row.evaluationAreaId, reason: 'evaluation area not found' });
        continue;
      }

      if (mappedAreaIds.has(row.evaluationAreaId)) {
        result.skipped.push({
          evaluationAreaId: row.evaluationAreaId,
          reason: `this form is already mapped to "${area.name}"`,
        });
        continue;
      }
      mappedAreaIds.add(row.evaluationAreaId);

      const mapping = await this.prisma.formKpiMapping.create({
        data: {
          formId,
          evaluationAreaId: row.evaluationAreaId,
          evaluateeFieldKeys: input.evaluateeFieldKeys ?? [],
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
          detail: { evaluateeFieldKeys: input.evaluateeFieldKeys, count: result.created.length },
        },
      });
      await this.invalidateDashboardCache();
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
    await this.invalidateDashboardCache();
    return null;
  }

  private async requireForm(formId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);
    return form;
  }
}
