import { z } from 'zod';

/** KPI definition & mapping contracts, shared by API validation and admin UI.
 *  A KPI is just a named container; Evaluation Areas underneath it carry the
 *  actual 0-5 scoring, per person, per period — see EvaluationAreaEntry. */

export const createKpiSchema = z.object({
  name: z.string().min(2).max(200),
  /** Relative importance as a percentage (0-100) — informational only, not
   *  required to sum to 100 across sibling KPIs. */
  weight: z.number().min(0).max(100).optional(),
});

export type CreateKpiInput = z.infer<typeof createKpiSchema>;

export const updateKpiSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  weight: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateKpiInput = z.infer<typeof updateKpiSchema>;

/** Map a KPI to a role, department, and/or delivery stream — at least one. */
export const kpiAssignmentSchema = z
  .object({
    roleId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    deliveryStream: z.string().min(2).max(64).optional(),
  })
  .refine((a) => a.roleId || a.departmentId || a.deliveryStream, {
    message: 'assignment needs at least one of roleId, departmentId, deliveryStream',
  });

export type KpiAssignmentInput = z.infer<typeof kpiAssignmentSchema>;

export const EVALUATION_AREA_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;

export const createEvaluationAreaSchema = z.object({
  name: z.string().min(2).max(200),
  cadence: z.enum(EVALUATION_AREA_CADENCES),
});

export type CreateEvaluationAreaInput = z.infer<typeof createEvaluationAreaSchema>;

export const updateEvaluationAreaSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  cadence: z.enum(EVALUATION_AREA_CADENCES).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateEvaluationAreaInput = z.infer<typeof updateEvaluationAreaSchema>;

/** A named leaf under an Evaluation Area — pure taxonomy, no scoring/cadence
 *  of its own (see EvaluationArea's own doc comment for where those live). */
export const createSubCriteriaSchema = z.object({
  name: z.string().min(2).max(200),
});

export type CreateSubCriteriaInput = z.infer<typeof createSubCriteriaSchema>;

export const updateSubCriteriaSchema = z.object({
  name: z.string().min(2).max(200).optional(),
});

export type UpdateSubCriteriaInput = z.infer<typeof updateSubCriteriaSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date (YYYY-MM-DD)');

/** A 0-5 score for one Evaluation Area, recorded against a specific evaluatee. */
export const recordEvaluationAreaEntrySchema = z
  .object({
    personId: z.string().uuid(),
    value: z.number().min(0).max(5),
    periodStart: isoDate,
    periodEnd: isoDate,
    note: z.string().max(1000).optional(),
  })
  .refine((e) => e.periodStart < e.periodEnd, {
    path: ['periodEnd'],
    message: 'periodEnd must be after periodStart',
  });

export type RecordEvaluationAreaEntryInput = z.infer<typeof recordEvaluationAreaEntrySchema>;

/** Correcting a mis-entered score — only the value/note, not who or which
 *  period it's for (that's the entry's identity; move it by deleting and
 *  re-recording instead). */
export const updateEvaluationAreaEntrySchema = z.object({
  value: z.number().min(0).max(5).optional(),
  note: z.string().max(1000).optional(),
});

export type UpdateEvaluationAreaEntryInput = z.infer<typeof updateEvaluationAreaEntrySchema>;
