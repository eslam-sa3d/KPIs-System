import { z } from 'zod';
import { mediaSchema } from './form-media';
import { END_OF_FORM, FormSection, SectionBranchRule, formSectionSchema } from './form-sections';

/** Field types with an exact-match-comparable answer — everything except
 *  ranking (an ordered permutation), file (an opaque upload id), grid (one
 *  answer per row, not a single value), and section_header (never has an
 *  answer). Shared with the builder UI so the trigger-field picker and the
 *  validator never drift apart. */
export const BRANCH_TRIGGER_TYPES: FieldType[] = [
  'select', 'multi_select', 'rating', 'likert', 'boolean', 'nps', 'short_text', 'long_text', 'number', 'date',
  'slider', 'hot_spot', 'time',
];

/**
 * Form Builder contract — the schema-of-schemas.
 *
 * An admin-built form is data, not code: a versioned document of typed fields
 * with validation rules and conditional visibility. This Zod contract
 * validates the *form definition itself*; the API additionally compiles each
 * definition into a runtime answer-validator.
 */

export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'date',
  /** time-of-day only, no date component — compared as an "HH:mm" string */
  'time',
  'select',
  'multi_select',
  'boolean',
  'rating',
  'nps',
  'likert',
  'ranking',
  'file',
  /** display-only: a heading + optional help text, no answer, never required. */
  'section_header',
  /** continuous drag input — a number answer, distinct UX from the discrete rating pills */
  'slider',
  /** compound name+email+phone question, each part independently required */
  'contact_info',
  /** click a named region on an image; answer is that region's value */
  'hot_spot',
  /** live search-and-select of a real user; answer is that User's id. */
  'person',
  /** Google-Forms-style "grid": a shared set of column choices answered once
   *  per row. `selection: 'single'` is a "multiple choice grid" (one column
   *  per row); `'multiple'` is a "checkbox grid" (any columns per row). */
  'grid',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const fieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'field keys must be snake_case identifiers');

export const CONDITION_OPERATORS = ['equals', 'not_equals', 'gt', 'lt', 'contains'] as const;

/** Answer piping: `{{field_key}}` inside a label/helpText is replaced at fill
 *  time with that field's current answer (SurveyMonkey-style merge tags). */
export const PIPE_TAG_PATTERN = /\{\{([a-z][a-z0-9_]*)\}\}/g;

function pipeReferences(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(PIPE_TAG_PATTERN)].map((m) => m[1]!);
}

const conditionValue = z.union([z.string(), z.number(), z.boolean()]);

/** Conditional visibility: `operator` defaults to equality for back-compat. */
const visibleWhenSchema = z.object({
  fieldKey,
  operator: z.enum(CONDITION_OPERATORS).default('equals'),
  equals: conditionValue,
});

const baseField = z.object({
  key: fieldKey,
  label: z.string().min(1).max(200),
  helpText: z.string().max(500).optional(),
  required: z.boolean().default(false),
  visibleWhen: visibleWhenSchema.optional(),
  media: mediaSchema.optional(),
  /** UTM-style hidden field: never shown to the respondent — its value is read once from
   *  this query-string parameter on load and submitted automatically. */
  capturedFromUrlParam: z.string().max(100).optional(),
});

const optionItem = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  /** FormAsset id — renders this option as an image choice. */
  imageAssetId: z.string().uuid().optional(),
});

export const formFieldSchema = z.discriminatedUnion('type', [
  baseField.extend({
    type: z.literal('short_text'),
    maxLength: z.number().int().positive().max(500).default(200),
    /** Google Forms-style "response validation" */
    minLength: z.number().int().positive().optional(),
    pattern: z.string().max(200).optional(),
    patternErrorMessage: z.string().max(200).optional(),
    /** quiz mode: any case-insensitive match counts as correct */
    correctAnswers: z.array(z.string().min(1).max(500)).optional(),
    points: z.number().positive().optional(),
    /** quiz mode: shown per-question on the thank-you screen, see quiz-scoring.ts's perField */
    feedbackCorrect: z.string().max(500).optional(),
    feedbackIncorrect: z.string().max(500).optional(),
  }),
  baseField.extend({
    type: z.literal('long_text'),
    maxLength: z.number().int().positive().max(10_000).default(2000),
    minLength: z.number().int().positive().optional(),
    pattern: z.string().max(200).optional(),
    patternErrorMessage: z.string().max(200).optional(),
  }),
  baseField.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integerOnly: z.boolean().default(false),
    correctValue: z.number().optional(),
    points: z.number().positive().optional(),
    feedbackCorrect: z.string().max(500).optional(),
    feedbackIncorrect: z.string().max(500).optional(),
  }),
  baseField.extend({ type: z.literal('date') }),
  /** time-of-day only. Answer is an "HH:mm" (24h) string — comparable and
   *  sortable as-is, no timezone concerns since there's no date component. */
  baseField.extend({ type: z.literal('time') }),
  baseField.extend({
    type: z.literal('select'),
    options: z.array(optionItem).min(1).max(200),
    /** radio buttons (MS Forms default) or a dropdown */
    layout: z.enum(['dropdown', 'radio']).default('dropdown'),
    /** append a free-text "Other" option */
    allowOther: z.boolean().default(false),
    /** randomize option order per respondent */
    shuffleOptions: z.boolean().default(false),
    /** quiz mode: must match an option's value exactly */
    correctValue: z.string().optional(),
    points: z.number().positive().optional(),
    feedbackCorrect: z.string().max(500).optional(),
    feedbackIncorrect: z.string().max(500).optional(),
  }),
  baseField.extend({
    type: z.literal('multi_select'),
    options: z.array(optionItem).min(1).max(200),
    maxSelections: z.number().int().positive().optional(),
    shuffleOptions: z.boolean().default(false),
    /** append a free-text "Other" option, matching `select`'s allowOther */
    allowOther: z.boolean().default(false),
    /** quiz mode: the respondent's selections must equal this SET exactly (order-independent) */
    correctValues: z.array(z.string()).optional(),
    points: z.number().positive().optional(),
    feedbackCorrect: z.string().max(500).optional(),
    feedbackIncorrect: z.string().max(500).optional(),
  }),
  baseField.extend({
    type: z.literal('boolean'),
    correctValue: z.boolean().optional(),
    points: z.number().positive().optional(),
    feedbackCorrect: z.string().max(500).optional(),
    feedbackIncorrect: z.string().max(500).optional(),
  }),
  baseField.extend({
    type: z.literal('rating'),
    scale: z.number().int().min(2).max(10).default(5),
    lowLabel: z.string().max(60).optional(),
    highLabel: z.string().max(60).optional(),
    /** visual style only — same value/scoring semantics either way */
    style: z.enum(['pills', 'stars']).default('pills'),
  }),
  /** Net Promoter Score: fixed 0–10 */
  baseField.extend({
    type: z.literal('nps'),
    lowLabel: z.string().max(60).default('not at all likely'),
    highLabel: z.string().max(60).default('extremely likely'),
  }),
  /** Likert matrix: statements × a shared scale */
  baseField.extend({
    type: z.literal('likert'),
    statements: z.array(optionItem).min(1).max(30),
    scale: z.array(z.string().min(1).max(60)).min(2).max(7),
  }),
  /** Ranking: respondent orders every option */
  baseField.extend({
    type: z.literal('ranking'),
    options: z.array(optionItem).min(2).max(20),
    /** randomize the STARTING order shown, before the respondent reorders it */
    shuffleOptions: z.boolean().default(false),
  }),
  /** Grid: a shared set of column choices answered once per row. Google
   *  Forms ships this as two separate types (multiple choice grid / checkbox
   *  grid) that differ only in whether a row takes one answer or several —
   *  modeled here as one type with a selection switch instead of duplicating
   *  rows/columns/validation twice. Not a BRANCH_TRIGGER_TYPES member: a
   *  per-row answer set isn't a single exact-match-comparable value. */
  baseField.extend({
    type: z.literal('grid'),
    rows: z.array(optionItem).min(1).max(30),
    columns: z.array(optionItem).min(2).max(10),
    selection: z.enum(['single', 'multiple']).default('single'),
    /** every row must have at least one answer to submit — Forms' "require a response in each row" */
    requireOnePerRow: z.boolean().default(false),
  }),
  baseField.extend({
    type: z.literal('file'),
    acceptedMimeTypes: z.array(z.string()).min(1),
    maxSizeMb: z.number().positive().max(25).default(10),
    /** 1 (default) keeps the answer a single upload id, matching every existing form;
     *  >1 turns the answer into an array of upload ids, up to this count. */
    maxFiles: z.number().int().min(1).max(10).default(1),
  }),
  baseField.extend({ type: z.literal('section_header') }),
  baseField.extend({
    type: z.literal('slider'),
    min: z.number().default(0),
    max: z.number().default(100),
    step: z.number().positive().default(1),
    lowLabel: z.string().max(60).optional(),
    highLabel: z.string().max(60).optional(),
  }),
  /** Compound name+email+phone question — each part independently required. */
  baseField.extend({
    type: z.literal('contact_info'),
    requireName: z.boolean().default(true),
    requireEmail: z.boolean().default(true),
    requirePhone: z.boolean().default(false),
  }),
  /** Click a named region on an image. Regions are 0–100 percentages of the
   *  image's own box, so they stay aligned at any render size. */
  baseField.extend({
    type: z.literal('hot_spot'),
    imageAssetId: z.string().uuid(),
    regions: z
      .array(
        z.object({
          value: z.string().min(1).max(200),
          label: z.string().min(1).max(200),
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
          width: z.number().positive().max(100),
          height: z.number().positive().max(100),
        }),
      )
      .min(1)
      .max(20),
  }),
  /** Live search-and-select of a real user — the answer is a User id, not
   *  free text. No extra config needed beyond the base field (label/help/
   *  required); resolving it against the users table happens at submission
   *  time, the same trust-boundary split as 'file' (structural shape here,
   *  referential integrity in the service layer). */
  baseField.extend({ type: z.literal('person') }),
]);

/** Per-form collection settings (MS-Forms parity). */
export const formSettingsSchema = z.object({
  acceptingResponses: z.boolean().default(true),
  opensAt: z.string().datetime().optional(),
  closesAt: z.string().datetime().optional(),
  oneResponsePerUser: z.boolean().default(false),
  shuffleQuestions: z.boolean().default(false),
  thankYouMessage: z.string().max(500).default('thank you!'),
  /** stop accepting responses once this many submissions exist */
  maxResponses: z.number().int().positive().optional(),
  /** quiz mode: score submissions against each field's correctValue/points */
  quizMode: z.boolean().default(false),
  /** percent of total points required to "pass" — only meaningful with quizMode */
  passThresholdPercent: z.number().min(0).max(100).optional(),
  /** show the respondent their score/pass-fail on the thank-you screen */
  showScoreToRespondent: z.boolean().default(true),
  /** randomize page order per respondent — only takes effect client-side when
   *  no page has a branching rule (see FormRenderer); order-independent
   *  reachability means the server needs no changes to support this. */
  shuffleSections: z.boolean().default(false),
  /** conditional response quotas (SurveyMonkey parity): stop counting toward this
   *  quota's own limit once the field's answer matches `equals` this many times —
   *  distinct from the blanket `maxResponses` above. Reuses the same JSONB-path
   *  equality concept as the response-list drill-down filter. */
  quotas: z
    .array(
      z.object({
        fieldKey,
        equals: z.string().min(1).max(200),
        limit: z.number().int().positive(),
      }),
    )
    .max(20)
    .default([]),
  /** lets a respondent revise their own submission via a signed edit token
   *  returned at submit time — distinct from admin-only response editing. */
  allowRespondentEdit: z.boolean().default(false),
  /** require a passing Cloudflare Turnstile check on public submissions — default
   *  off, since most forms here are internal. See TurnstileService. */
  requireCaptcha: z.boolean().default(false),
  /** fire-and-forget POST of every new submission to this URL — failures are
   *  logged, never block or fail the submission itself. */
  webhookUrl: z.string().url().max(2000).optional(),
});

export type FormSettings = z.infer<typeof formSettingsSchema>;
export const DEFAULT_FORM_SETTINGS: FormSettings = formSettingsSchema.parse({});

export const formDefinitionSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    fields: z.array(formFieldSchema).min(1).max(100),
    /** optional multi-page layout with forward-only branching between pages */
    sections: z.array(formSectionSchema).min(1).max(50).optional(),
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
      if (field.type === 'section_header' && field.required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'required'],
          message: 'a "section_header" field has no answer and cannot be required',
        });
      }
      if (field.visibleWhen && !form.fields.some((f) => f.key === field.visibleWhen!.fieldKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'visibleWhen', 'fieldKey'],
          message: `visibleWhen references unknown field "${field.visibleWhen.fieldKey}"`,
        });
      }
      for (const [prop, text] of [['label', field.label], ['helpText', field.helpText]] as const) {
        for (const pipedKey of pipeReferences(text)) {
          if (!form.fields.some((f) => f.key === pipedKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['fields', index, prop],
              message: `{{${pipedKey}}} references an unknown field key`,
            });
          }
        }
      }
    });

    if (!form.sections) return;
    validateSections(form.fields, form.sections, ctx);
  });

function validateSections(
  fields: FormField[],
  sections: FormSection[],
  ctx: z.RefinementCtx,
): void {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const sectionIds = new Set(sections.map((s) => s.id));
  const sectionIndexById = new Map(sections.map((s, i) => [s.id, i]));
  const assignedFieldKeys = new Set<string>();

  const duplicateSectionIds = sections
    .map((s) => s.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateSectionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: `duplicate section id(s): ${[...new Set(duplicateSectionIds)].join(', ')}`,
    });
  }

  sections.forEach((section, sectionIndex) => {
    for (const key of section.fieldKeys) {
      if (!fieldByKey.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', sectionIndex, 'fieldKeys'],
          message: `section "${section.id}" references unknown field "${key}"`,
        });
        continue;
      }
      if (assignedFieldKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', sectionIndex, 'fieldKeys'],
          message: `field "${key}" is assigned to more than one section`,
        });
      }
      assignedFieldKeys.add(key);
    }

    const validateRule = (rule: SectionBranchRule, path: (string | number)[]) => {
      if (rule.onFieldKey) {
        const trigger = fieldByKey.get(rule.onFieldKey);
        if (!trigger) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, 'onFieldKey'],
            message: `branching references unknown field "${rule.onFieldKey}"`,
          });
        } else {
          if (!BRANCH_TRIGGER_TYPES.includes(trigger.type)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'onFieldKey'],
              message: `branching can only key off a ${BRANCH_TRIGGER_TYPES.map((t) => `"${t}"`).join(', ')} field (got "${trigger.type}")`,
            });
          }
          if (!section.fieldKeys.includes(rule.onFieldKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'onFieldKey'],
              message: `branching field "${rule.onFieldKey}" must belong to section "${section.id}"`,
            });
          }
          if (trigger.type === 'likert') {
            if (!rule.onStatement) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'onStatement'],
                message: 'onStatement is required when branching keys off a "likert" field',
              });
            } else if (!trigger.statements.some((s) => s.value === rule.onStatement)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'onStatement'],
                message: `"${rule.onStatement}" is not a statement on likert field "${rule.onFieldKey}"`,
              });
            }
          } else if (rule.onStatement) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'onStatement'],
              message: 'onStatement is only valid when branching keys off a "likert" field',
            });
          }
        }
      }

      const targets = [...rule.cases.map((c) => c.goTo), ...(rule.defaultGoTo ? [rule.defaultGoTo] : [])];
      targets.forEach((target, targetIndex) => {
        if (target === END_OF_FORM) return;
        if (!sectionIds.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, 'cases', targetIndex],
            message: `branching target "${target}" is not a section id`,
          });
          return;
        }
        // forward-only: a section may only jump to one that comes AFTER it
        if (sectionIndexById.get(target)! <= sectionIndex) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, 'cases', targetIndex],
            message: `branching target "${target}" must come after section "${section.id}" — only forward jumps are allowed`,
          });
        }
      });
    };

    if (section.branching) validateRule(section.branching, ['sections', sectionIndex, 'branching']);
    section.branchRules?.forEach((rule, ruleIndex) =>
      validateRule(rule, ['sections', sectionIndex, 'branchRules', ruleIndex]),
    );
  });

  const unassigned = fields.map((f) => f.key).filter((key) => !assignedFieldKeys.has(key));
  if (unassigned.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: `field(s) not assigned to any section: ${unassigned.join(', ')}`,
    });
  }
}

export type FormField = z.infer<typeof formFieldSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/** A submission maps fieldKey → answer. Likert answers are row→scale-index
 *  records; rankings are ordered arrays of option values; contact_info answers
 *  are a name/email/phone record of strings; a "single"-selection grid answer
 *  is row→column-value, a "multiple"-selection grid answer is row→column-values[]. */
export const submissionAnswersSchema = z.record(
  fieldKey,
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), z.number()),
    z.record(z.string(), z.string()),
    z.record(z.string(), z.array(z.string())),
    z.null(),
  ]),
);
export type SubmissionAnswers = z.infer<typeof submissionAnswersSchema>;
