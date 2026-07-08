import { z } from 'zod';

/** KPI definition & mapping contracts, shared by API validation and admin UI. */

export const KPI_DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;
export const KPI_CADENCES = ['weekly', 'monthly', 'quarterly'] as const;

export const createKpiSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Z][A-Z0-9-]*$/, 'codes are UPPER-KEBAB, e.g. DEL-VEL-01'),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  unit: z.string().min(1).max(32),
  direction: z.enum(KPI_DIRECTIONS),
  target: z.number().finite().optional(),
  cadence: z.enum(KPI_CADENCES),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateKpiInput = z.infer<typeof createKpiSchema>;

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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date (YYYY-MM-DD)');

export const recordKpiEntrySchema = z
  .object({
    value: z.number().finite(),
    periodStart: isoDate,
    periodEnd: isoDate,
    note: z.string().max(1000).optional(),
  })
  .refine((e) => e.periodStart < e.periodEnd, {
    path: ['periodEnd'],
    message: 'periodEnd must be after periodStart',
  });

export type RecordKpiEntryInput = z.infer<typeof recordKpiEntrySchema>;
