import { z } from 'zod';

/** Names a job title for the Configuration page's Job Titles tab — plain
 *  label, no score range (unlike PerformanceLevel). */

export const createJobTitleSchema = z.object({
  label: z.string().min(2).max(80),
});

export type CreateJobTitleInput = z.infer<typeof createJobTitleSchema>;

export const updateJobTitleSchema = z.object({
  label: z.string().min(2).max(80),
});

export type UpdateJobTitleInput = z.infer<typeof updateJobTitleSchema>;
