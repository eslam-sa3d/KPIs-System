import type { FormField, SubmissionAnswers } from '@pulse/contracts';

/** Detects a raw User id stored where a display name is expected — a 'person' field's
 *  answer always matches; some forms also store a per-area evaluatee id in an ordinary
 *  text field (or a 'select' option built via "select a user"), so this is checked
 *  against every field, not just ones typed 'person'. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every distinct user id referenced anywhere in one submission's answers — 'person'-typed
 *  fields unconditionally, plus a UUID-shape scan across every other field's raw value(s)
 *  (including inside array-valued fields like multi_select/ranking, where a "link to a
 *  user" option's value IS that user's id). Deliberately generic: works for any field
 *  type/name, so a 'select' field with a user-linked option resolves a real person the
 *  same way a dedicated 'person' field does, with no special-casing required. */
export function detectReferencedUserIds(fields: FormField[], answers: SubmissionAnswers): Set<string> {
  const personFieldKeys = new Set(fields.filter((f) => f.type === 'person').map((f) => f.key));
  const ids = new Set<string>();
  for (const field of fields) {
    const v = answers[field.key];
    if (typeof v === 'string' && v && (personFieldKeys.has(field.key) || UUID_PATTERN.test(v))) {
      ids.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === 'string' && UUID_PATTERN.test(item)) ids.add(item);
    }
  }
  return ids;
}
