import { z } from 'zod';

/** Names a single point on the 0-5 EvaluationAreaEntry score scale for the
 *  Configuration page's Score Labels tab (e.g. 5 = "Outstanding"). */

export const createScoreLabelSchema = z.object({
  label: z.string().min(2).max(80),
  score: z.number().int().min(0).max(5),
});

export type CreateScoreLabelInput = z.infer<typeof createScoreLabelSchema>;

export const updateScoreLabelSchema = z.object({
  label: z.string().min(2).max(80).optional(),
  score: z.number().int().min(0).max(5).optional(),
});

export type UpdateScoreLabelInput = z.infer<typeof updateScoreLabelSchema>;
