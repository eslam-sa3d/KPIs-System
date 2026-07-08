import { FormDefinition, FormField, SubmissionAnswers } from '@pulse/contracts';
import { z, ZodTypeAny } from 'zod';

/**
 * Compiles an admin-built FormDefinition (stored JSONB) into a runtime Zod
 * validator for submissions. This is the trust boundary of the submission
 * engine: client-side validation is UX, THIS is security.
 *
 * Conditional fields: a field hidden by its `visibleWhen` rule is not
 * required and any provided answer for it is discarded.
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

      for (const field of definition.fields) {
        const visible = isVisible(field, raw);
        const value = raw[field.key];

        if (!visible) continue; // hidden answers are dropped, never stored

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

      // Reject answers for keys that don't exist in this form version.
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

function isVisible(field: FormField, answers: SubmissionAnswers): boolean {
  if (!field.visibleWhen) return true;
  return answers[field.visibleWhen.fieldKey] === field.visibleWhen.equals;
}

function validatorFor(field: FormField): ZodTypeAny {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return z.string().max(field.maxLength);
    case 'number': {
      let schema = field.integerOnly ? z.number().int() : z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date (YYYY-MM-DD)');
    case 'select':
      return z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
    case 'multi_select': {
      const item = z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
      let schema = z.array(item).min(1);
      if (field.maxSelections) schema = schema.max(field.maxSelections);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'rating':
      return z.number().int().min(1).max(field.scale);
    case 'file':
      // Files are uploaded separately; the answer is the stored object key.
      return z.string().min(1).max(500);
  }
}
