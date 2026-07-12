import { z } from 'zod';

/** Names a band of the 0-5 EvaluationAreaEntry score range for the
 *  Configuration page's Performance Levels tab (e.g. 4.0-5.0 = "Outstanding"). */

export const createPerformanceLevelSchema = z
  .object({
    label: z.string().min(2).max(80),
    minScore: z.number().min(0).max(5),
    maxScore: z.number().min(0).max(5),
  })
  .refine((v) => v.maxScore >= v.minScore, {
    message: 'maxScore must be greater than or equal to minScore',
    path: ['maxScore'],
  });

export type CreatePerformanceLevelInput = z.infer<typeof createPerformanceLevelSchema>;

export const updatePerformanceLevelSchema = z
  .object({
    label: z.string().min(2).max(80).optional(),
    minScore: z.number().min(0).max(5).optional(),
    maxScore: z.number().min(0).max(5).optional(),
  })
  .refine((v) => v.minScore === undefined || v.maxScore === undefined || v.maxScore >= v.minScore, {
    message: 'maxScore must be greater than or equal to minScore',
    path: ['maxScore'],
  });

export type UpdatePerformanceLevelInput = z.infer<typeof updatePerformanceLevelSchema>;
