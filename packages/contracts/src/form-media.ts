import { z } from 'zod';

/**
 * Inline question media: an uploaded FormAsset image, or an external video
 * embed URL. Deliberately its own leaf module (no dependency on form-schema)
 * so a shared media type doesn't create a circular edge.
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
