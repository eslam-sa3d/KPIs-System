import { z } from 'zod';

/**
 * Inline question/page media: an uploaded FormAsset image, or an external
 * video embed URL. Deliberately its own leaf module (no dependency on
 * form-schema or form-sections) — both of those already depend on each
 * other in one direction (form-schema needs formSectionSchema at eval
 * time), so a shared media type must not create a second, circular edge.
 */
export const mediaSchema = z.object({
  type: z.enum(['image', 'video']),
  /** FormAsset id — required when type is "image". */
  assetId: z.string().uuid().optional(),
  /** external embed URL (e.g. YouTube) — required when type is "video". */
  url: z.string().max(1000).optional(),
  alt: z.string().max(200).optional(),
});

export type Media = z.infer<typeof mediaSchema>;
