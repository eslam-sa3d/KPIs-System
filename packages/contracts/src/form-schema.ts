import { z } from 'zod';

/**
 * Form Builder contract — the schema-of-schemas.
 *
 * An admin-built form is data, not code: a versioned document of typed fields
 * with validation rules and optional conditional visibility. This Zod contract
 * validates the *form definition itself*; the API additionally compiles each
 * definition into a runtime answer-validator (see apps/api forms module).
 */

export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'date',
  'select',
  'multi_select',
  'boolean',
  'rating',
  'file',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const fieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'field keys must be snake_case identifiers');

const baseField = z.object({
  key: fieldKey,
  label: z.string().min(1).max(200),
  helpText: z.string().max(500).optional(),
  required: z.boolean().default(false),
  /** Show this field only when another field matches a value. */
  visibleWhen: z
    .object({ fieldKey, equals: z.union([z.string(), z.number(), z.boolean()]) })
    .optional(),
});

const optionItem = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});

export const formFieldSchema = z.discriminatedUnion('type', [
  baseField.extend({
    type: z.literal('short_text'),
    maxLength: z.number().int().positive().max(500).default(200),
  }),
  baseField.extend({
    type: z.literal('long_text'),
    maxLength: z.number().int().positive().max(10_000).default(2000),
  }),
  baseField.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integerOnly: z.boolean().default(false),
  }),
  baseField.extend({ type: z.literal('date') }),
  baseField.extend({
    type: z.literal('select'),
    options: z.array(optionItem).min(1).max(200),
  }),
  baseField.extend({
    type: z.literal('multi_select'),
    options: z.array(optionItem).min(1).max(200),
    maxSelections: z.number().int().positive().optional(),
  }),
  baseField.extend({ type: z.literal('boolean') }),
  baseField.extend({
    type: z.literal('rating'),
    scale: z.number().int().min(2).max(10).default(5),
  }),
  baseField.extend({
    type: z.literal('file'),
    acceptedMimeTypes: z.array(z.string()).min(1),
    maxSizeMb: z.number().positive().max(25).default(10),
  }),
]);

export const formDefinitionSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    fields: z.array(formFieldSchema).min(1).max(100),
  })
  .superRefine((form, ctx) => {
    const keys = new Set<string>();
    form.fields.forEach((field, index) => {
      if (keys.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'key'],
          message: `duplicate field key "${field.key}"`,
        });
      }
      keys.add(field.key);
      if (field.visibleWhen && !form.fields.some((f) => f.key === field.visibleWhen!.fieldKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'visibleWhen', 'fieldKey'],
          message: `visibleWhen references unknown field "${field.visibleWhen.fieldKey}"`,
        });
      }
    });
  });

export type FormField = z.infer<typeof formFieldSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/** A submission is a map of fieldKey → answer; validated server-side per form version. */
export const submissionAnswersSchema = z.record(
  fieldKey,
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
);
export type SubmissionAnswers = z.infer<typeof submissionAnswersSchema>;
