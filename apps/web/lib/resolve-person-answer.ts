/** Detects a raw User id stored where a display name is expected — a 'person'
 *  field's answer always matches; some forms also store a per-area evaluatee id
 *  in an ordinary text field, so this is checked regardless of field type. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves a 'person' (or UUID-shaped) answer to its display name; a UUID that
 *  matches no known user falls back to "(deleted user)" for a confirmed 'person'
 *  field, or is left as-is elsewhere so a coincidentally UUID-shaped value isn't
 *  mislabeled. Non-UUID values pass through untouched. */
export function resolvePersonAnswer(
  value: string,
  personNames: Record<string, string>,
  isPersonField: boolean,
): string {
  if (isPersonField) return personNames[value] ?? '(deleted user)';
  if (UUID_PATTERN.test(value)) return personNames[value] ?? value;
  return value;
}

/** Resolves a 'performance_level' answer (a PerformanceLevel id, not free
 *  text) to its label — same live-lookup split as person answers:
 *  structural id in the stored answer, referential label resolved here
 *  against the Configuration page's live Performance Levels list. Falls
 *  back to the raw id if that level was since renamed away or deleted. */
export function resolvePerformanceLevelAnswer(value: string, performanceLevelLabels: Record<string, string>): string {
  return performanceLevelLabels[value] ?? value;
}
