import { z } from 'zod';
import type { FormDefinition, SubmissionAnswers } from './form-schema';

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

export const sectionBranchRuleSchema = z.object({
  /** must reference a `select` field that belongs to this same section */
  onFieldKey: z.string().min(1).max(64),
  /** answer value → target section id, or "end" to submit immediately */
  cases: z
    .array(
      z.object({
        equals: z.string(),
        goTo: z.union([sectionId, z.literal(END_OF_FORM)]),
      }),
    )
    .min(1)
    .max(50),
  /** fallback when no case matches; omitted = fall through to the next section in order */
  defaultGoTo: z.union([sectionId, z.literal(END_OF_FORM)]).optional(),
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
      const answer = answers[rule.onFieldKey];
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
