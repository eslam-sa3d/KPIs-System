import { EvaluationAreaCadence } from './kpi';

/**
 * A KPI reduced to just what "link this to a KPI" pickers need: identity plus
 * its Evaluation Areas as selectable leaves. Projected from KpisService.list()
 * — shared verbatim so the KPI-link combobox, the form-builder's per-field KPI
 * link, and the KPI-mappings panel don't each hand-roll their own subset.
 */
export interface KpiOptionSummary {
  id: string;
  name: string;
  evaluationAreas: Array<{
    id: string;
    name: string;
    cadence: EvaluationAreaCadence;
    isActive: boolean;
    subCriteria: Array<{ id: string; name: string }>;
  }>;
}

/** A single scored form submission, shown on its own native scale — e.g.
 *  "4/5" for a rating field, "8/10" for NPS. Never blended with any other
 *  mapping's answer, so what's displayed always traces back to one real
 *  FormSubmission. `raw` is the field's native answer shape (number,
 *  string, string[], or a likert index map) — only meaningful to compare
 *  against another `raw` from the exact same mapping. */
export interface ScoredSubmissionSummary {
  raw: unknown;
  display: string;
  submittedAt: string;
}

/** One row of KpisService.getTeamOverview()'s org-wide roster. */
export interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  roles: string[];
  hasKpi: boolean;
  /** Normalized 0-5 blend across every EvaluationAreaEntry covering this
   *  person (same computation the write path has always produced) — null
   *  when they have none. Powers the dashboard's Outstanding/Meets/Needs
   *  improvement/Below/Pending status cards and the Performance-Level
   *  visibility gate; every other field on this type is a raw, per-submission
   *  value on its own native scale. */
  score: number | null;
  /** Sum of every one of this person's scored submissions, all-time (not
   *  blended/averaged, and not windowed to a period) — grows as they're
   *  evaluated more. Distinct from `score` (the older 0-5 blend, still used
   *  for the status cards and the Performance-Level visibility gate): this
   *  is what a totalScore-scale Performance Level range (see
   *  `performanceLevel`) is matched against. Null when they have no scored
   *  submissions at all. */
  totalScore: number | null;
  /** The configured Performance Level `totalScore` falls into — always a
   *  real, admin-configured level from the Configuration page, never a
   *  hardcoded status band or a fallback to `score` (the older
   *  EvaluationAreaEntry blend, which can hold seed/migrated data
   *  unconnected to anything actually configured). Null when nothing is
   *  configured, `totalScore` is null, or it's below every configured
   *  level's minScore. */
  performanceLevel: { id: string; label: string } | null;
  /** The person's single most recent scored submission, across every KPI
   *  area that covers them — null when they've never been scored ("pending",
   *  not "scored a 0"). Includes which area/KPI it was for since a person
   *  can be covered by more than one. */
  latestSubmission: (ScoredSubmissionSummary & { areaName: string; kpiName: string }) | null;
  /** Only set when the submission immediately before `latestSubmission` came
   *  through the exact same mapping (same field, same scale) — otherwise
   *  there's nothing valid to compare against, so no trend is shown. */
  previousSubmission: ScoredSubmissionSummary | null;
  /** The more recent of `latestSubmission`'s date and this person's latest
   *  raw-activity submission's date (see `rawActivityCount`) — so someone
   *  with only unmapped-form activity, no scored submission at all, still
   *  shows a real date instead of null. */
  lastUpdated: string | null;
  /** Count of this person's own raw-activity submissions (see
   *  RawActivityEntry) — activity from forms with no KPI mapping at all that
   *  still name this person somewhere in their answers. Separate from and
   *  never blended with `score`/`latestSubmission`, which stay strictly
   *  scored/mapped. Always a number (0 when they have none), unlike the
   *  null-means-never-scored idiom `latestSubmission` uses, since there's no
   *  meaningful distinction between "never checked" and "zero" here. */
  rawActivityCount: number;
}

/** Response of GET /v1/kpis/team-overview — shared verbatim between
 *  KpisService.getTeamOverview() and the dashboard's admin team view. */
export interface TeamOverview {
  totalActiveUsers: number;
  members: TeamMember[];
}

/** One of a team member's own scored submissions, for the detail drawer's
 *  chronological feed — not blended with any other submission, even within
 *  the same Evaluation Area (see ScoredSubmissionSummary). */
export interface PersonSubmission extends ScoredSubmissionSummary {
  kpiId: string;
  kpiName: string;
  areaId: string;
  areaName: string;
  evaluatorName: string;
  anonymous: boolean;
  reviewType: string;
  context: string | null;
  comment: string | null;
}

/** One answered field on a raw-activity submission (see RawActivityEntry) —
 *  formatted the same way a ScoredSubmissionSummary.display is (via
 *  describeAnswer), but a raw-activity submission has no single "the score
 *  field", so this is every describable answer, not one value. */
export interface RawActivityAnswer {
  fieldKey: string;
  fieldLabel: string;
  display: string;
}

/** One submission to a form with zero active FormKpiMapping that names this
 *  person somewhere in its answers (any 'person' field, or any field whose
 *  answer is a real user id — see detectReferencedUserIds) — the dashboard's
 *  signal that real form activity about this person exists even though no
 *  KPI scoring pipeline is wired up for it yet. Never blended, never scored,
 *  same "trace back to one real FormSubmission" posture as PersonSubmission. */
export interface RawActivityEntry {
  formId: string;
  formSlug: string;
  formTitle: string;
  submittedByName: string | null;
  submissionId: string;
  submittedAt: string;
  answers: RawActivityAnswer[];
}

/** Response of GET /v1/kpis/team-overview/:personId — a single team member's
 *  own scored submissions across every KPI that covers them, most recent
 *  first, for the dashboard's team member detail drawer. */
export interface TeamMemberBreakdown {
  personId: string;
  displayName: string;
  /** Same all-time-sum rule as TeamMember.totalScore — computed from every
   *  one of this person's scored submissions, not just the recent ones in
   *  `submissions` below. Null until they have a real scored submission —
   *  never falls back to the older EvaluationAreaEntry blend, which can
   *  hold seed/migrated data unconnected to any admin-configured Score
   *  Label or Performance Level. */
  totalScore: number | null;
  /** The configured Performance Level `totalScore` falls into — always a
   *  real, admin-configured level from the Configuration page, never a
   *  hardcoded status band. Null when nothing is configured, `totalScore`
   *  is null, or it's below every configured level's minScore. */
  performanceLevel: { id: string; label: string } | null;
  submissions: PersonSubmission[];
  /** This person's own raw-activity entries (see RawActivityEntry), most
   *  recent first — omitted/empty when they have none. Separate list from
   *  `submissions` (scored) so the drawer can show both without conflating
   *  them. */
  rawActivity?: RawActivityEntry[];
}

/** A score-eligible question on a published form with no FormKpiMapping
 *  pointing at it yet — a question built to grade something, whose answers
 *  never reach a KPI. */
export interface UnmappedQuestion {
  formSlug: string;
  formTitle: string;
  fieldKey: string;
  fieldLabel: string;
}

/** An active Evaluation Area that hasn't been scored in longer than its own
 *  cadence reasonably allows (a grace period beyond one full cycle) —
 *  `lastScoredAt` is null when it's never been scored at all, distinct from
 *  "went quiet after being scored." */
export interface StaleKpiArea {
  kpiId: string;
  kpiName: string;
  areaId: string;
  areaName: string;
  cadence: EvaluationAreaCadence;
  lastScoredAt: string | null;
}

/** Response of GET /v1/kpis/measurement-gaps — org-wide signals for "are we
 *  actually measuring what we think we are," distinct from per-person
 *  "pending evaluation" (which only catches a gap for one person at a time). */
export interface MeasurementGaps {
  unmappedQuestions: { total: number; items: UnmappedQuestion[] };
  staleAreas: { total: number; items: StaleKpiArea[] };
}

/** One entry's free-text context/comment, for the dashboard's qualitative
 *  feedback digest — respects the same anonymity rule as everywhere else
 *  (evaluatorName withheld for a caller without kpis:manage when the
 *  originating mapping marked it anonymous). */
export interface FeedbackEntry {
  id: string;
  kpiId: string;
  kpiName: string;
  areaName: string;
  personName: string;
  evaluatorName: string;
  anonymous: boolean;
  /** The score that came with this feedback, pre-formatted on its native
   *  scale (e.g. "4/5") — same value as ScoredSubmissionSummary.display. */
  display: string;
  context: string | null;
  comment: string | null;
  createdAt: string;
}

/** Response of GET /v1/kpis/recent-feedback. */
export interface RecentFeedback {
  entries: FeedbackEntry[];
}

/** One point in the org-wide evaluation activity trend — a count of new
 *  Evaluation Area entries recorded in that week. */
export interface ActivityTrendPoint {
  /** ISO date (Monday) of the week this point covers. */
  weekStart: string;
  count: number;
}

/** Response of GET /v1/kpis/activity-trend. */
export interface ActivityTrend {
  points: ActivityTrendPoint[];
}
