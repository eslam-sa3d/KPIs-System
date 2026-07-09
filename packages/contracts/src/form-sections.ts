import { z } from 'zod';
import type { FormDefinition, FormField, SubmissionAnswers } from './form-schema';

/**
 * Page/section branching (MS-Forms parity): a form can be split into ordered
 * pages ("sections"). Each section can branch to a LATER section — or end
 * the form early — based on the answer to one choice field within it.
 * Forward-only by design (enforced in formDefinitionSchema's superRefine):
 * it keeps the model a DAG, so there is no cycle/loop to detect or guard
 * against at fill time.
 */

export const END_OF_FORM = 'end' as const;

const sectionId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'section ids must be lower-kebab/snake identifiers');

export const sectionBranchRuleSchema = z
  .object({
    /**
     * Required when `cases` is non-empty: must reference a `select`,
     * `rating`, or `likert` field belonging to this same section.
     */
    onFieldKey: z.string().min(1).max(64).optional(),
    /**
     * Required (and only meaningful) when `onFieldKey` names a `likert`
     * field — a likert answer is one index per statement, so branching
     * needs to know WHICH statement's answer drives the jump.
     */
    onStatement: z.string().min(1).max(64).optional(),
    /**
     * Answer value → target section id, or "end" to submit immediately.
     * `equals` is always compared as a string: a `select` case matches the
     * option value verbatim; a `rating` case matches the stringified score
     * (e.g. "4"); a `likert` case matches the stringified 0-based scale
     * index of the chosen statement (e.g. "0" for the first scale label).
     */
    cases: z
      .array(
        z.object({
          equals: z.string(),
          goTo: z.union([sectionId, z.literal(END_OF_FORM)]),
        }),
      )
      .max(50)
      .default([]),
    /**
     * Fallback when no case matches. With `cases` empty, this is an
     * UNCONDITIONAL jump — the section's own "always go to" override,
     * needed to skip a sibling branch and reconverge (no answer required).
     * Omitted entirely = fall through to the next section in array order.
     */
    defaultGoTo: z.union([sectionId, z.literal(END_OF_FORM)]).optional(),
  })
  .refine((rule) => rule.cases.length > 0 || rule.defaultGoTo !== undefined, {
    message: 'branching must set at least one case or a defaultGoTo',
  })
  .refine((rule) => rule.cases.length === 0 || rule.onFieldKey !== undefined, {
    message: 'onFieldKey is required when cases are present',
    path: ['onFieldKey'],
  });

export type SectionBranchRule = z.infer<typeof sectionBranchRuleSchema>;

export const formSectionSchema = z.object({
  id: sectionId,
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  /** every field belonging to this page, in display order */
  fieldKeys: z.array(z.string().min(1).max(64)).min(1).max(50),
  branching: sectionBranchRuleSchema.optional(),
});

export type FormSection = z.infer<typeof formSectionSchema>;

/**
 * Reduces a branch trigger field's raw answer to the single string a
 * case's `equals` compares against. `select` answers are already strings;
 * `rating` and `likert` are numeric/matrix and need a type-aware reduction
 * (see `sectionBranchRuleSchema` field comments for the exact encoding).
 */
function extractTriggerAnswer(
  rule: SectionBranchRule,
  fieldByKey: Map<string, FormField>,
  answers: SubmissionAnswers,
): string | undefined {
  if (!rule.onFieldKey) return undefined;
  const field = fieldByKey.get(rule.onFieldKey);
  const raw = answers[rule.onFieldKey];
  if (!field || raw === undefined || raw === null) return undefined;

  if (field.type === 'likert') {
    if (!rule.onStatement) return undefined;
    const index = (raw as Record<string, number>)[rule.onStatement];
    return index === undefined ? undefined : String(index);
  }
  if (field.type === 'rating') return String(raw);
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Walks a form's sections from the first one, following branching rules and
 * the respondent's ANSWERED values, until it reaches `end` or runs out of
 * sections. Deterministic and side-effect-free — the same (definition,
 * answers) pair always resolves to the same path, so both the browser (to
 * decide which page to show next) and the API (to know which fields were
 * actually reachable, and therefore which `required` fields to enforce) can
 * call this and agree.
 *
 * A field belongs to the submission iff its section was visited — sections
 * skipped by a branch are treated exactly like a hidden `visibleWhen` field:
 * dropped, never required.
 */
export function resolveSectionPath(
  definition: Pick<FormDefinition, 'fields'> & { sections?: FormSection[] },
  answers: SubmissionAnswers,
): { visitedSectionIds: string[]; reachableFieldKeys: Set<string> } {
  const sections = definition.sections;
  if (!sections || sections.length === 0) {
    // no sections: every field is reachable (existing flat-form behavior)
    return {
      visitedSectionIds: [],
      reachableFieldKeys: new Set(definition.fields.map((f) => f.key)),
    };
  }

  const fieldByKey = new Map(definition.fields.map((f) => [f.key, f]));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const visitedSectionIds: string[] = [];
  const reachableFieldKeys = new Set<string>();

  let current: FormSection | undefined = sections[0];
  const guard = new Set<string>(); // defensive: forward-only schema already forbids cycles

  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    visitedSectionIds.push(current.id);
    for (const key of current.fieldKeys) reachableFieldKeys.add(key);

    const rule = current.branching;
    let nextId: string | undefined;

    if (rule) {
      const answer = extractTriggerAnswer(rule, fieldByKey, answers);
      const matched = rule.cases.find((c) => c.equals === answer);
      nextId = matched?.goTo ?? rule.defaultGoTo;
    }

    if (nextId === undefined) {
      // no rule, or no match and no default: fall through to next section in order
      const index = sections.indexOf(current);
      const following = sections[index + 1];
      current = following;
      continue;
    }

    if (nextId === END_OF_FORM) break;
    current = byId.get(nextId);
  }

  return { visitedSectionIds, reachableFieldKeys };
}
