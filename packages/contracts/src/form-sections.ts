import { z } from 'zod';
import { mediaSchema } from './form-media';
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
     * index of the chosen statement (e.g. "0" for the first scale label);
     * a `multi_select` case matches when the respondent's selections
     * INCLUDE that option value (not exact-equality — MS Forms semantics).
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
  media: mediaSchema.optional(),
  /** every field belonging to this page, in display order */
  fieldKeys: z.array(z.string().min(1).max(64)).min(1).max(50),
  /**
   * @deprecated superseded by `branchRules` (an ordered list — one rule can
   * only key off a single field, so a page needing more than one independent
   * trigger needed several sections to work around it). Kept so already-
   * published FormVersion JSON (immutable once created) keeps validating and
   * rendering; new/edited forms should only ever write `branchRules`.
   */
  branching: sectionBranchRuleSchema.optional(),
  /** Every rule is tried in array order; the first one that matches (by a
   *  case, or its own defaultGoTo) wins. Lets a page branch on more than one
   *  question, and — since a page can hold just one field — effectively
   *  gives per-question routing without a separate graph model. */
  branchRules: z.array(sectionBranchRuleSchema).max(10).optional(),
});

export type FormSection = z.infer<typeof formSectionSchema>;

type BranchCase = SectionBranchRule['cases'][number];

/**
 * Finds the case (if any) matching the trigger field's answer. `multi_select`
 * uses "includes" semantics (see `sectionBranchRuleSchema`'s `cases` comment);
 * every other trigger type reduces to a single string and matches by equality.
 */
function findMatchedCase(
  rule: SectionBranchRule,
  fieldByKey: Map<string, FormField>,
  answers: SubmissionAnswers,
): BranchCase | undefined {
  if (!rule.onFieldKey) return undefined;
  const field = fieldByKey.get(rule.onFieldKey);
  const raw = answers[rule.onFieldKey];
  if (!field || raw === undefined || raw === null) return undefined;

  if (field.type === 'multi_select') {
    if (!Array.isArray(raw)) return undefined;
    return rule.cases.find((c) => raw.includes(c.equals));
  }

  let answer: string | undefined;
  if (field.type === 'likert') {
    const index = rule.onStatement === undefined ? undefined : (raw as Record<string, number>)[rule.onStatement];
    answer = index === undefined ? undefined : String(index);
  } else if (
    field.type === 'rating' ||
    field.type === 'nps' ||
    field.type === 'number' ||
    field.type === 'boolean' ||
    field.type === 'slider'
  ) {
    // all five stringify losslessly for exact-match comparison
    answer = String(raw);
  } else {
    // short_text, long_text, select, date, time, hot_spot — already stored as the raw string
    answer = typeof raw === 'string' ? raw : undefined;
  }
  return rule.cases.find((c) => c.equals === answer);
}

/** Runs a page's branch rules in order; the first one that produces a target (via a
 *  matched case or its own defaultGoTo) wins. Falls back to the legacy singular
 *  `branching` field when a section has no `branchRules` (old published definitions). */
function resolveBranchTarget(
  section: FormSection,
  fieldByKey: Map<string, FormField>,
  answers: SubmissionAnswers,
): string | undefined {
  const rules = section.branchRules && section.branchRules.length > 0
    ? section.branchRules
    : section.branching
      ? [section.branching]
      : [];
  for (const rule of rules) {
    const matched = findMatchedCase(rule, fieldByKey, answers);
    const target = matched?.goTo ?? rule.defaultGoTo;
    if (target !== undefined) return target;
  }
  return undefined;
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

    const nextId = resolveBranchTarget(current, fieldByKey, answers);

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
