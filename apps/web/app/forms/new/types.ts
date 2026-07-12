import { CONDITION_OPERATORS, type FieldType, type KpiOptionSummary } from '@pulse/contracts';

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface DraftField {
  /** Pinned to the original field's key when hydrated for editing — keeps
   *  visibleWhen references, quotas, KPI mappings, and existing submission
   *  answers stable across a republish even if the label changes or the
   *  field moves. undefined (brand-new fields) falls back to toKey(label, index). */
  key?: string;
  label: string;
  helpText: string;
  type: FieldType;
  required: boolean;
  /** comma-separated: select/multi_select/ranking options, or likert statements */
  options: string;
  layout: 'dropdown' | 'radio';
  allowOther: boolean;
  /** select/multi_select/ranking: randomize option order per respondent */
  shuffleOptions: boolean;
  scale: number;
  lowLabel: string;
  highLabel: string;
  /** comma-separated likert scale labels, e.g. "disagree,neutral,agree" */
  likertScale: string;
  /** comma-separated MIME types accepted for a file-upload field */
  acceptedMimeTypes: string;
  maxSizeMb: number;
  maxFiles: number;
  /** option value -> uploaded FormAsset id, for select/multi_select/ranking "image choice" options */
  optionImages: Record<string, string>;
  /** option value -> that User's id, for a 'select' option added via "select a user"
   *  instead of typed — see optionItem.userId in form-schema.ts. */
  optionUserIds: Record<string, string>;
  /** select only, Google-Forms-style "go to section based on answer": option
   *  value -> target page id, or "end". A missing/'' entry for an option
   *  means "continue to the next page". */
  optionGoTo: Record<string, string>;
  mediaType: 'none' | 'image' | 'video';
  mediaAssetId: string;
  /** video: an external embed URL (e.g. YouTube) */
  mediaUrl: string;
  mediaAlt: string;
  /** conditional visibility: '' = always visible */
  visibleWhenFieldKey: string;
  visibleWhenOperator: ConditionOperator;
  visibleWhenValue: string;
  /** quiz mode: 0/empty = not gradable. Meaning of correctValue depends on type:
   *  select -> an option value; number -> parsed as a number; boolean -> 'true'/'false'. */
  points: number;
  correctValue: string;
  /** multi_select: comma-separated set of option values that must all (and only) be selected */
  correctValues: string;
  /** short_text: comma-separated, case-insensitive any-of accepted answers */
  correctAnswers: string;
  /** quiz mode: shown per-question on the thank-you screen. '' = no feedback text. */
  feedbackCorrect: string;
  feedbackIncorrect: string;
  /** short_text/long_text: Google Forms-style response validation. 0 = no minimum. */
  minLength: number;
  pattern: string;
  patternErrorMessage: string;
  /** rating: visual style only */
  ratingStyle: 'pills' | 'stars';
  /** slider */
  sliderMin: number;
  sliderMax: number;
  sliderStep: number;
  /** contact_info: which parts are required */
  requireName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  /** hot_spot */
  hotSpotAssetId: string;
  hotSpotRegions: Array<{ value: string; label: string; x: number; y: number; width: number; height: number }>;
  /** grid: comma-separated row statements and shared column choices */
  gridRows: string;
  gridColumns: string;
  /** grid: one column per row ("multiple choice grid") or any columns per row ("checkbox grid") */
  gridSelection: 'single' | 'multiple';
  gridRequireOnePerRow: boolean;
  /** UTM-style hidden field: '' = a normal, respondent-filled question. When set, this
   *  question is never shown — its value is read once from this query-string parameter. */
  capturedFromUrlParam: string;
  /** KPI scoring link (optional, rating/nps/slider only) — mirrors a real
   *  FormKpiMapping row 1:1, not a property on the field definition itself.
   *  kpiId only narrows the evaluation-area picker; evaluationAreaId is what
   *  actually drives mapping creation. kpiMappingId is set once a real
   *  mapping exists (hydrated from an existing form, or just created) — its
   *  presence is what "linked" means, not kpiId/evaluationAreaId alone. */
  kpiId: string;
  evaluationAreaId: string;
  kpiMappingId: string;
}

/** Google Forms model: a page has no independently-editable field list — it's
 *  just "every question from `startFieldKey` up to the next page's start", in
 *  the form's own question order. The very first page has `startFieldKey:
 *  null` (it implicitly starts at the top). Dragging a question above/below a
 *  page's start field moves it into that page automatically — no separate
 *  bookkeeping required, matching how Google Forms' section breaks behave. */
export interface DraftSection {
  id: string;
  title: string;
  description: string;
  mediaType: 'none' | 'image' | 'video';
  mediaAssetId: string;
  mediaUrl: string;
  mediaAlt: string;
  startFieldKey: string | null;
  /** Google-Forms-style "after this page, go to..." — the page's own fallback
   *  once none of its `select` fields' own optionGoTo redirected elsewhere.
   *  '' = continue to the next page normally. */
  defaultGoTo: string;
}

export type KpiOption = KpiOptionSummary;

export interface KeyedField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  scale: number;
  likertScale: string[];
}
