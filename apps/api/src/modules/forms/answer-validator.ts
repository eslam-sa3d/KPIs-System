import { FormDefinition, FormField, SubmissionAnswers, resolveSectionPath } from '@pulse/contracts';
import { z, ZodTypeAny } from 'zod';

/**
 * Compiles an admin-built FormDefinition (stored JSONB) into a runtime Zod
 * validator for submissions. This is the trust boundary of the submission
 * engine: client-side validation is UX, THIS is security.
 */
export function compileAnswerValidator(definition: FormDefinition) {
  const fieldValidators = new Map<string, ZodTypeAny>(
    definition.fields.map((field) => [field.key, validatorFor(field)]),
  );

  return {
    /** Returns cleaned answers or throws z.ZodError with field-level paths. */
    validate(raw: SubmissionAnswers): SubmissionAnswers {
      const issues: z.ZodIssue[] = [];
      const cleaned: SubmissionAnswers = {};
      // fields on a section the branch path skipped are treated like a
      // hidden visibleWhen field: dropped, never required.
      const { reachableFieldKeys } = resolveSectionPath(definition, raw);

      for (const field of definition.fields) {
        if (definition.sections && !reachableFieldKeys.has(field.key)) continue;
        if (!isVisible(field, raw)) continue; // hidden answers are dropped, never stored
        const value = raw[field.key];

        if (value === undefined || value === null || value === '') {
          if (field.required) {
            issues.push({
              code: z.ZodIssueCode.custom,
              path: [field.key],
              message: `"${field.label}" is required`,
            });
          }
          continue;
        }

        const result = fieldValidators.get(field.key)!.safeParse(value);
        if (result.success) {
          cleaned[field.key] = result.data;
        } else {
          issues.push(
            ...result.error.issues.map((issue) => ({ ...issue, path: [field.key, ...issue.path] })),
          );
        }
      }

      for (const key of Object.keys(raw)) {
        if (!fieldValidators.has(key)) {
          issues.push({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'unknown field for this form version',
          });
        }
      }

      if (issues.length) throw new z.ZodError(issues);
      return cleaned;
    },
  };
}

export function isVisible(field: FormField, answers: SubmissionAnswers): boolean {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const actual = answers[rule.fieldKey];
  const expected = rule.equals;
  switch (rule.operator ?? 'equals') {
    case 'not_equals':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'contains':
      return Array.isArray(actual)
        ? actual.includes(String(expected))
        : typeof actual === 'string' && actual.includes(String(expected));
    default:
      return actual === expected;
  }
}

function validatorFor(field: FormField): ZodTypeAny {
  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      let schema = z.string().max(field.maxLength);
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.pattern) {
        try {
          schema = schema.regex(new RegExp(field.pattern), field.patternErrorMessage ?? 'does not match the required format');
        } catch {
          // an invalid regex saved to a field shouldn't crash the validator — just skip the pattern check
        }
      }
      return schema;
    }
    case 'number': {
      let schema = field.integerOnly ? z.number().int() : z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date (YYYY-MM-DD)');
    case 'time':
      return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected 24h time (HH:mm)');
    case 'select': {
      const known = z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
      // "Other" answers are stored as "other:<free text>"
      return field.allowOther
        ? z.union([known, z.string().startsWith('other:').max(260)])
        : known;
    }
    case 'multi_select': {
      const known = z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
      // "Other" answers are stored as "other:<free text>", same convention as `select`
      const item = field.allowOther ? z.union([known, z.string().startsWith('other:').max(260)]) : known;
      let schema = z.array(item).min(1);
      if (field.maxSelections) schema = schema.max(field.maxSelections);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'rating':
      return z.number().int().min(1).max(field.scale);
    case 'nps':
      return z.number().int().min(0).max(10);
    case 'likert': {
      // record of statement value → 0-based scale index, every statement answered
      const keys = field.statements.map((s) => s.value);
      return z
        .record(z.enum(keys as [string, ...string[]]), z.number().int().min(0).max(field.scale.length - 1))
        .refine((answers) => keys.every((k) => answers[k] !== undefined), {
          message: 'every statement must be answered',
        });
    }
    case 'ranking': {
      const values = field.options.map((o) => o.value);
      return z
        .array(z.enum(values as [string, ...string[]]))
        .length(values.length)
        .refine((order) => new Set(order).size === order.length, {
          message: 'ranking must order every option exactly once',
        });
    }
    case 'file': {
      const uploadId = z.string().min(1).max(500);
      // maxFiles===1 (every pre-existing form) keeps the original single-id shape —
      // this is the real trust boundary for the per-question file-count cap.
      return field.maxFiles > 1 ? z.array(uploadId).min(1).max(field.maxFiles) : uploadId;
    }
    case 'section_header':
      // display-only: never has an answer to validate
      return z.undefined();
    case 'slider':
      return z.number().min(field.min).max(field.max);
    case 'contact_info':
      return z.object({
        name: field.requireName ? z.string().min(1).max(200) : z.string().max(200).optional(),
        email: field.requireEmail
          ? z.string().email().max(320)
          : z.union([z.string().email().max(320), z.literal('')]).optional(),
        phone: field.requirePhone ? z.string().min(1).max(40) : z.string().max(40).optional(),
      });
    case 'hot_spot': {
      const values = field.regions.map((r) => r.value);
      return z.enum(values as [string, ...string[]]);
    }
    case 'person':
      // structural shape only — SubmissionsService resolves this against a
      // real, active user at persist time, the actual trust boundary.
      return z.string().uuid();
    case 'grid': {
      const rowKeys = field.rows.map((r) => r.value) as [string, ...string[]];
      const columnEnum = z.enum(field.columns.map((c) => c.value) as [string, ...string[]]);
      const perRow: ZodTypeAny = field.selection === 'multiple' ? z.array(columnEnum).min(1) : columnEnum;
      let schema: ZodTypeAny = z.record(z.enum(rowKeys), perRow);
      if (field.requireOnePerRow) {
        schema = schema.refine(
          (answers: Record<string, unknown>) => rowKeys.every((k) => answers[k] !== undefined),
          { message: 'every row must be answered' },
        );
      }
      return schema;
    }
  }
}
