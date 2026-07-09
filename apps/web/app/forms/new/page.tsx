'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { BRANCH_TRIGGER_TYPES, CONDITION_OPERATORS, END_OF_FORM, FORM_FONT_FAMILIES, type FieldType } from '@pulse/contracts';
import { palette } from '@pulse/theme';

const THEME_SWATCHES = [
  palette.primary.purple,
  palette.primary.coral,
  palette.secondary.moonLight,
  palette.tertiary.sea,
  palette.tertiary.oasis,
  palette.tertiary.sunset,
];

type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
import { PortalShell } from '../../../components/portal-shell';
import { api, assetUrl, uploadAsset } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'short_text', label: 'short text' },
  { value: 'long_text', label: 'long text' },
  { value: 'number', label: 'number' },
  { value: 'date', label: 'date' },
  { value: 'boolean', label: 'yes / no' },
  { value: 'rating', label: 'rating (2–10)' },
  { value: 'nps', label: 'net promoter score (0–10)' },
  { value: 'select', label: 'choice (one answer)' },
  { value: 'multi_select', label: 'choice (multiple answers)' },
  { value: 'likert', label: 'likert matrix' },
  { value: 'ranking', label: 'ranking' },
  { value: 'file', label: 'file upload' },
  { value: 'section_header', label: 'section heading (no answer)' },
  { value: 'slider', label: 'slider' },
  { value: 'contact_info', label: 'contact info (name / email / phone)' },
  { value: 'hot_spot', label: 'hot spot (click a region on an image)' },
];

const parseList = (raw: string) =>
  raw.split(',').map((s) => s.trim()).filter(Boolean);

interface DraftField {
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
  /** UTM-style hidden field: '' = a normal, respondent-filled question. When set, this
   *  question is never shown — its value is read once from this query-string parameter. */
  capturedFromUrlParam: string;
}

const emptyField = (): DraftField => ({
  label: '',
  helpText: '',
  type: 'short_text',
  required: false,
  options: '',
  layout: 'dropdown',
  allowOther: false,
  shuffleOptions: false,
  scale: 5,
  lowLabel: '',
  highLabel: '',
  likertScale: 'disagree, neutral, agree',
  acceptedMimeTypes: 'application/pdf, image/png, image/jpeg',
  maxSizeMb: 10,
  maxFiles: 1,
  optionImages: {},
  mediaType: 'none',
  mediaAssetId: '',
  mediaUrl: '',
  mediaAlt: '',
  visibleWhenFieldKey: '',
  visibleWhenOperator: 'equals',
  visibleWhenValue: '',
  points: 0,
  correctValue: '',
  correctValues: '',
  correctAnswers: '',
  feedbackCorrect: '',
  feedbackIncorrect: '',
  minLength: 0,
  pattern: '',
  patternErrorMessage: '',
  ratingStyle: 'pills',
  sliderMin: 0,
  sliderMax: 100,
  sliderStep: 1,
  requireName: true,
  requireEmail: true,
  requirePhone: false,
  hotSpotAssetId: '',
  hotSpotRegions: [],
  capturedFromUrlParam: '',
});

const toKey = (label: string, index: number) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`;
};

interface KeyedField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  scale: number;
  likertScale: string[];
}

/** The fixed set of possible answers for a trigger field, or null when the domain isn't enumerable
 *  (short_text/long_text/number/date — the admin must type an exact value to match instead). */
function caseKeysFor(trigger: KeyedField | undefined): string[] | null {
  if (!trigger) return null;
  switch (trigger.type) {
    case 'rating':
      return Array.from({ length: trigger.scale }, (_, i) => String(i + 1));
    case 'nps':
      return Array.from({ length: 11 }, (_, i) => String(i));
    case 'boolean':
      return ['true', 'false'];
    case 'likert':
      return trigger.likertScale.map((_, i) => String(i));
    case 'select':
    case 'multi_select':
      return trigger.options;
    default:
      return null;
  }
}

function caseLabelOf(trigger: KeyedField | undefined, key: string): string {
  if (trigger?.type === 'likert') return trigger.likertScale[Number(key)] ?? key;
  if (trigger?.type === 'boolean') return key === 'true' ? 'yes' : 'no';
  return key;
}

interface DraftBranchRule {
  /** the field this rule branches on */
  fieldKey: string;
  /** only used when fieldKey names a likert field: which statement drives the branch */
  statement: string;
  /** answer (or stringified rating/nps/boolean/likert-index) -> target page id / "end" */
  cases: Array<{ equals: string; goTo: string }>;
  /** unconditional/fallback target page id or "end"; '' = continue to the next page normally */
  defaultGoTo: string;
}

const emptyBranchRule = (): DraftBranchRule => ({ fieldKey: '', statement: '', cases: [], defaultGoTo: '' });

interface DraftSection {
  id: string;
  title: string;
  description: string;
  mediaType: 'none' | 'image' | 'video';
  mediaAssetId: string;
  mediaUrl: string;
  mediaAlt: string;
  fieldKeys: string[];
  /** every page can carry more than one independent branch rule (MS-Forms parity) */
  branchRules: DraftBranchRule[];
}

const emptySection = (index: number): DraftSection => ({
  id: `page_${index + 1}`,
  title: '',
  description: '',
  mediaType: 'none',
  mediaAssetId: '',
  mediaUrl: '',
  mediaAlt: '',
  fieldKeys: [],
  branchRules: [],
});

/** Coerces the builder's always-string visibleWhen value to match its target field's answer shape
 *  (a boolean-target field stores real booleans; gt/lt need a real number to compare). */
function coerceVisibleWhenValue(raw: string, operator: ConditionOperator, targetType: FieldType | undefined) {
  if (operator === 'gt' || operator === 'lt') return Number(raw);
  if (targetType === 'boolean') return raw === 'true';
  if (targetType === 'number' || targetType === 'rating' || targetType === 'nps') return Number(raw);
  return raw;
}

function toDefinitionField(draft: DraftField, index: number, keyedFields: KeyedField[]) {
  const visibleWhenTarget = keyedFields.find((f) => f.key === draft.visibleWhenFieldKey);
  const base = {
    key: toKey(draft.label, index),
    label: draft.label,
    required: draft.required,
    ...(draft.helpText.trim() ? { helpText: draft.helpText.trim() } : {}),
    ...(draft.mediaType === 'image' && draft.mediaAssetId
      ? { media: { type: 'image' as const, assetId: draft.mediaAssetId, ...(draft.mediaAlt ? { alt: draft.mediaAlt } : {}) } }
      : draft.mediaType === 'video' && draft.mediaUrl
        ? { media: { type: 'video' as const, url: draft.mediaUrl, ...(draft.mediaAlt ? { alt: draft.mediaAlt } : {}) } }
        : {}),
    ...(draft.visibleWhenFieldKey && draft.visibleWhenValue !== ''
      ? {
          visibleWhen: {
            fieldKey: draft.visibleWhenFieldKey,
            operator: draft.visibleWhenOperator,
            equals: coerceVisibleWhenValue(draft.visibleWhenValue, draft.visibleWhenOperator, visibleWhenTarget?.type),
          },
        }
      : {}),
    ...(draft.capturedFromUrlParam.trim() ? { capturedFromUrlParam: draft.capturedFromUrlParam.trim() } : {}),
  };
  const withImages = (values: string[]) =>
    values.map((o) => ({ value: o, label: o, ...(draft.optionImages[o] ? { imageAssetId: draft.optionImages[o] } : {}) }));
  const quizPoints = draft.points > 0 ? { points: draft.points } : {};
  const quizFeedback = {
    ...(draft.feedbackCorrect.trim() ? { feedbackCorrect: draft.feedbackCorrect.trim() } : {}),
    ...(draft.feedbackIncorrect.trim() ? { feedbackIncorrect: draft.feedbackIncorrect.trim() } : {}),
  };
  switch (draft.type) {
    case 'select': {
      const options = withImages(parseList(draft.options));
      return {
        ...base,
        type: draft.type,
        options,
        layout: draft.layout,
        allowOther: draft.allowOther,
        shuffleOptions: draft.shuffleOptions,
        ...(draft.points > 0 && draft.correctValue
          ? { correctValue: draft.correctValue, ...quizPoints, ...quizFeedback }
          : {}),
      };
    }
    case 'multi_select': {
      const options = withImages(parseList(draft.options));
      return {
        ...base,
        type: draft.type,
        options,
        shuffleOptions: draft.shuffleOptions,
        ...(draft.points > 0 && draft.correctValues.trim()
          ? { correctValues: parseList(draft.correctValues), ...quizPoints, ...quizFeedback }
          : {}),
      };
    }
    case 'boolean':
      return {
        ...base,
        type: draft.type,
        ...(draft.points > 0 && draft.correctValue
          ? { correctValue: draft.correctValue === 'true', ...quizPoints, ...quizFeedback }
          : {}),
      };
    case 'short_text':
      return {
        ...base,
        type: draft.type,
        ...(draft.minLength > 0 ? { minLength: draft.minLength } : {}),
        ...(draft.pattern.trim() ? { pattern: draft.pattern.trim() } : {}),
        ...(draft.patternErrorMessage.trim() ? { patternErrorMessage: draft.patternErrorMessage.trim() } : {}),
        ...(draft.points > 0 && draft.correctAnswers.trim()
          ? { correctAnswers: parseList(draft.correctAnswers), ...quizPoints, ...quizFeedback }
          : {}),
      };
    case 'long_text':
      return {
        ...base,
        type: draft.type,
        ...(draft.minLength > 0 ? { minLength: draft.minLength } : {}),
        ...(draft.pattern.trim() ? { pattern: draft.pattern.trim() } : {}),
        ...(draft.patternErrorMessage.trim() ? { patternErrorMessage: draft.patternErrorMessage.trim() } : {}),
      };
    case 'number':
      return {
        ...base,
        type: draft.type,
        ...(draft.points > 0 && draft.correctValue !== ''
          ? { correctValue: Number(draft.correctValue), ...quizPoints, ...quizFeedback }
          : {}),
      };
    case 'ranking': {
      const options = withImages(parseList(draft.options));
      return { ...base, type: draft.type, options, shuffleOptions: draft.shuffleOptions };
    }
    case 'likert': {
      const statements = parseList(draft.options).map((o) => ({ value: o, label: o }));
      const scale = parseList(draft.likertScale);
      return { ...base, type: draft.type, statements, scale };
    }
    case 'file': {
      const acceptedMimeTypes = parseList(draft.acceptedMimeTypes);
      return { ...base, type: draft.type, acceptedMimeTypes, maxSizeMb: draft.maxSizeMb, maxFiles: draft.maxFiles };
    }
    case 'rating':
      return {
        ...base,
        type: draft.type,
        scale: draft.scale,
        style: draft.ratingStyle,
        ...(draft.lowLabel ? { lowLabel: draft.lowLabel } : {}),
        ...(draft.highLabel ? { highLabel: draft.highLabel } : {}),
      };
    case 'nps':
      return {
        ...base,
        type: draft.type,
        ...(draft.lowLabel ? { lowLabel: draft.lowLabel } : {}),
        ...(draft.highLabel ? { highLabel: draft.highLabel } : {}),
      };
    case 'slider':
      return {
        ...base,
        type: draft.type,
        min: draft.sliderMin,
        max: draft.sliderMax,
        step: draft.sliderStep,
        ...(draft.lowLabel ? { lowLabel: draft.lowLabel } : {}),
        ...(draft.highLabel ? { highLabel: draft.highLabel } : {}),
      };
    case 'contact_info':
      return {
        ...base,
        type: draft.type,
        requireName: draft.requireName,
        requireEmail: draft.requireEmail,
        requirePhone: draft.requirePhone,
      };
    case 'hot_spot':
      return {
        ...base,
        type: draft.type,
        imageAssetId: draft.hotSpotAssetId,
        regions: draft.hotSpotRegions,
      };
    default:
      return { ...base, type: draft.type };
  }
}

export default function NewFormPage() {
  const user = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ slug: string } | null>(null);
  const [sectionsEnabled, setSectionsEnabled] = useState(false);
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [importing, setImporting] = useState(false);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [themeAccentColor, setThemeAccentColor] = useState('');
  const [themeBackgroundAssetId, setThemeBackgroundAssetId] = useState('');
  const [themeLogoAssetId, setThemeLogoAssetId] = useState('');
  const [themeFontFamily, setThemeFontFamily] = useState<'' | (typeof FORM_FONT_FAMILIES)[number]>('');

  const keyedFields = fields.map((f, i) => ({
    key: toKey(f.label, i),
    label: f.label.trim() || `question ${i + 1}`,
    type: f.type,
    options: parseList(f.options),
    scale: f.scale,
    likertScale: parseList(f.likertScale),
  }));
  const unassignedFieldKeys = keyedFields
    .filter((f) => !sections.some((s) => s.fieldKeys.includes(f.key)))
    .map((f) => f.key);

  function addSection() {
    setSections((current) => [...current, emptySection(current.length)]);
  }

  /** Builder shortcut: put this question, plus every not-yet-assigned question after it, on a new page. */
  function splitPageHere(fieldIndex: number) {
    const fieldKey = keyedFields[fieldIndex]!.key;
    const newFieldKeys = keyedFields
      .slice(fieldIndex)
      .map((f) => f.key)
      .filter((k) => k === fieldKey || !sections.some((s) => s.fieldKeys.includes(k)));

    setSections((current) => {
      // pull the moved fields out of whatever page currently holds them, drop pages left empty
      const cleaned = current
        .map((s) => ({ ...s, fieldKeys: s.fieldKeys.filter((k) => !newFieldKeys.includes(k)) }))
        .filter((s) => s.fieldKeys.length > 0);

      // insert right after the page holding the field immediately before this one, if any
      const priorFieldKey = fieldIndex > 0 ? keyedFields[fieldIndex - 1]!.key : null;
      const priorPageIndex = priorFieldKey ? cleaned.findIndex((s) => s.fieldKeys.includes(priorFieldKey)) : -1;
      const insertAt = priorPageIndex === -1 ? cleaned.length : priorPageIndex + 1;

      const newSection: DraftSection = { ...emptySection(insertAt), fieldKeys: newFieldKeys };
      return [...cleaned.slice(0, insertAt), newSection, ...cleaned.slice(insertAt)];
    });
  }

  function updateSection(index: number, patch: Partial<DraftSection>) {
    setSections((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function moveSection(index: number, delta: number) {
    setSections((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function toggleFieldInSection(sectionIndex: number, fieldKey: string) {
    setSections((current) =>
      current.map((s, i) => {
        if (i === sectionIndex) {
          const has = s.fieldKeys.includes(fieldKey);
          return { ...s, fieldKeys: has ? s.fieldKeys.filter((k) => k !== fieldKey) : [...s.fieldKeys, fieldKey] };
        }
        // a field can only belong to one page — unassign it elsewhere when checked here
        return s.fieldKeys.includes(fieldKey) ? { ...s, fieldKeys: s.fieldKeys.filter((k) => k !== fieldKey) } : s;
      }),
    );
  }

  function addBranchRule(sectionIndex: number) {
    setSections((current) =>
      current.map((s, i) => (i === sectionIndex ? { ...s, branchRules: [...s.branchRules, emptyBranchRule()] } : s)),
    );
  }

  function removeBranchRule(sectionIndex: number, ruleIndex: number) {
    setSections((current) =>
      current.map((s, i) =>
        i === sectionIndex ? { ...s, branchRules: s.branchRules.filter((_, ri) => ri !== ruleIndex) } : s,
      ),
    );
  }

  function updateBranchRule(sectionIndex: number, ruleIndex: number, patch: Partial<DraftBranchRule>) {
    setSections((current) =>
      current.map((s, i) =>
        i === sectionIndex
          ? { ...s, branchRules: s.branchRules.map((r, ri) => (ri === ruleIndex ? { ...r, ...patch } : r)) }
          : s,
      ),
    );
  }

  function onTriggerFieldChange(sectionIndex: number, ruleIndex: number, fieldKey: string, keys: string[] | null) {
    updateBranchRule(sectionIndex, ruleIndex, {
      fieldKey,
      statement: '',
      cases: keys ? keys.map((k) => ({ equals: k, goTo: '' })) : [],
    });
  }

  function onStatementChange(sectionIndex: number, ruleIndex: number, statement: string, likertScale: string[]) {
    updateBranchRule(sectionIndex, ruleIndex, {
      statement,
      cases: likertScale.map((_, i) => ({ equals: String(i), goTo: '' })),
    });
  }

  function updateCase(
    sectionIndex: number,
    ruleIndex: number,
    caseIndex: number,
    patch: Partial<{ equals: string; goTo: string }>,
  ) {
    setSections((current) =>
      current.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              branchRules: s.branchRules.map((r, ri) =>
                ri === ruleIndex
                  ? { ...r, cases: r.cases.map((c, ci) => (ci === caseIndex ? { ...c, ...patch } : c)) }
                  : r,
              ),
            }
          : s,
      ),
    );
  }

  function addManualCase(sectionIndex: number, ruleIndex: number) {
    setSections((current) =>
      current.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              branchRules: s.branchRules.map((r, ri) =>
                ri === ruleIndex ? { ...r, cases: [...r.cases, { equals: '', goTo: '' }] } : r,
              ),
            }
          : s,
      ),
    );
  }

  function removeCase(sectionIndex: number, ruleIndex: number, caseIndex: number) {
    setSections((current) =>
      current.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              branchRules: s.branchRules.map((r, ri) =>
                ri === ruleIndex ? { ...r, cases: r.cases.filter((_, ci) => ci !== caseIndex) } : r,
              ),
            }
          : s,
      ),
    );
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function moveField(index: number, delta: number) {
    setFields((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function duplicateField(index: number) {
    setFields((current) => {
      const next = [...current];
      next.splice(index + 1, 0, { ...current[index]! });
      return next;
    });
  }

  async function onImportExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file after fixing it
    if (!file) return;

    setError(null);
    setImportIssues([]);
    setImporting(true);
    try {
      // lazy-loaded: the xlsx parsing engine only ships once someone actually imports a file
      const { parseFormWorkbook } = await import('../../../lib/parse-form-workbook');
      const { fields: parsed, issues, title: parsedTitle, description: parsedDescription } =
        await parseFormWorkbook(file);
      if (parsed.length === 0) {
        setError(issues[0] ?? 'no usable rows found — check that the sheet has a "question" column');
        return;
      }

      // only a .docx returns these, and only fills in blanks — never overwrites what's already typed
      if (parsedTitle && !title.trim()) setTitle(parsedTitle);
      if (parsedDescription && !description.trim()) setDescription(parsedDescription);

      const baseIndex = fields.length;
      setFields((current) => [
        ...current,
        ...parsed.map((p) => ({
          label: p.label,
          helpText: p.helpText,
          type: p.type,
          required: p.required,
          options: p.options,
          layout: 'dropdown' as const,
          allowOther: false,
          shuffleOptions: false,
          scale: p.scale,
          lowLabel: p.lowLabel,
          highLabel: p.highLabel,
          likertScale: p.likertScale,
          acceptedMimeTypes: p.acceptedMimeTypes,
          maxSizeMb: p.maxSizeMb,
          maxFiles: 1,
          optionImages: {},
          mediaType: 'none' as const,
          mediaAssetId: '',
          mediaUrl: '',
          mediaAlt: '',
          visibleWhenFieldKey: '',
          visibleWhenOperator: 'equals' as const,
          visibleWhenValue: '',
          points: 0,
          correctValue: '',
          correctValues: '',
          correctAnswers: '',
          feedbackCorrect: '',
          feedbackIncorrect: '',
          minLength: 0,
          pattern: '',
          patternErrorMessage: '',
          ratingStyle: 'pills' as const,
          sliderMin: 0,
          sliderMax: 100,
          sliderStep: 1,
          requireName: true,
          requireEmail: true,
          requirePhone: false,
          hotSpotAssetId: '',
          hotSpotRegions: [],
          capturedFromUrlParam: '',
        })),
      ]);
      setImportIssues(issues);

      if (parsed.some((p) => p.page)) {
        const importedKeys = parsed.map((p, i) => toKey(p.label, baseIndex + i));
        const pageOrder: string[] = [];
        const fieldKeysByPage = new Map<string, string[]>();
        parsed.forEach((p, i) => {
          if (!p.page) return;
          if (!fieldKeysByPage.has(p.page)) {
            pageOrder.push(p.page);
            fieldKeysByPage.set(p.page, []);
          }
          fieldKeysByPage.get(p.page)!.push(importedKeys[i]!);
        });

        setSectionsEnabled(true);
        setSections((current) => [
          ...current,
          ...pageOrder.map((pageName, i) => ({
            ...emptySection(current.length + i),
            title: pageName,
            fieldKeys: fieldKeysByPage.get(pageName)!,
          })),
        ]);
      }
    } catch {
      setError('could not read this file — is it a valid .xlsx, .csv, or .docx file?');
    } finally {
      setImporting(false);
    }
  }

  async function onUploadFieldMedia(index: number, file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      updateField(index, { mediaType: 'image', mediaAssetId: uploaded.id });
    } catch {
      setError('image upload failed');
    }
  }

  async function onUploadThemeBackground(file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      setThemeBackgroundAssetId(uploaded.id);
    } catch {
      setError('image upload failed');
    }
  }

  async function onUploadThemeLogo(file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      setThemeLogoAssetId(uploaded.id);
    } catch {
      setError('image upload failed');
    }
  }

  async function onUploadSectionMedia(index: number, file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      updateSection(index, { mediaType: 'image', mediaAssetId: uploaded.id });
    } catch {
      setError('image upload failed');
    }
  }

  async function onUploadOptionImage(index: number, optionValue: string, file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      setFields((current) =>
        current.map((f, i) =>
          i === index ? { ...f, optionImages: { ...f.optionImages, [optionValue]: uploaded.id } } : f,
        ),
      );
    } catch {
      setError('image upload failed');
    }
  }

  function buildSectionsPayload() {
    if (!sectionsEnabled || sections.length === 0) return undefined;
    return sections.map((s) => {
      const branchRules = s.branchRules
        .map((r) => {
          const cases = r.cases.filter((c) => c.equals && c.goTo).map(({ equals, goTo }) => ({ equals, goTo }));
          if (cases.length === 0 && !r.defaultGoTo) return null; // empty rule — drop it
          return {
            ...(r.fieldKey ? { onFieldKey: r.fieldKey } : {}),
            ...(r.statement ? { onStatement: r.statement } : {}),
            cases,
            ...(r.defaultGoTo ? { defaultGoTo: r.defaultGoTo } : {}),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return {
        id: s.id,
        ...(s.title.trim() ? { title: s.title.trim() } : {}),
        ...(s.description.trim() ? { description: s.description.trim() } : {}),
        ...(s.mediaType === 'image' && s.mediaAssetId
          ? { media: { type: 'image' as const, assetId: s.mediaAssetId, ...(s.mediaAlt ? { alt: s.mediaAlt } : {}) } }
          : s.mediaType === 'video' && s.mediaUrl
            ? { media: { type: 'video' as const, url: s.mediaUrl, ...(s.mediaAlt ? { alt: s.mediaAlt } : {}) } }
            : {}),
        fieldKeys: s.fieldKeys,
        ...(branchRules.length > 0 ? { branchRules } : {}),
      };
    });
  }

  function buildThemePayload() {
    if (!themeAccentColor && !themeBackgroundAssetId && !themeLogoAssetId && !themeFontFamily) return undefined;
    return {
      ...(themeAccentColor ? { accentColor: themeAccentColor } : {}),
      ...(themeBackgroundAssetId ? { backgroundAssetId: themeBackgroundAssetId } : {}),
      ...(themeLogoAssetId ? { logoAssetId: themeLogoAssetId } : {}),
      ...(themeFontFamily ? { fontFamily: themeFontFamily } : {}),
    };
  }

  async function onPublish() {
    setError(null);
    try {
      const slug = `${toKey(title, 0)}-${Date.now().toString(36)}`.replace(/_/g, '-');
      const form = await api<{ slug: string }>('/v1/forms', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          definition: {
            title,
            ...(description.trim() ? { description: description.trim() } : {}),
            fields: fields.map((f, i) => toDefinitionField(f, i, keyedFields)),
            ...(buildSectionsPayload() ? { sections: buildSectionsPayload() } : {}),
            ...(buildThemePayload() ? { theme: buildThemePayload() } : {}),
          },
        }),
      });
      setPublished({ slug: form.slug });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publishing failed');
    }
  }

  if (published) {
    return (
      <PortalShell user={user}>
        <h1>published ✓</h1>
        <p className="portal-subtitle">your form is live and accepting submissions.</p>
        <div className="page-title-row">
          <Link href={`/forms/view?slug=${encodeURIComponent(published.slug)}`} className="btn-primary">
            open form
          </Link>
          <Link href="/forms" className="btn-ghost">
            back to forms
          </Link>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell user={user}>
      <div className="msform">
        <header className="msform-banner msform-banner-edit">
          <label htmlFor="form-title">form title</label>
          <input
            id="form-title"
            className="msform-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="untitled form"
          />
          <label htmlFor="form-description" className="msform-desc-label">description (optional)</label>
          <input
            id="form-description"
            className="msform-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="tell respondents what this form is for"
          />
          <p className="msform-required-hint">
            questions render exactly as respondents will see them
          </p>
        </header>

        <div className="builder msform-body">
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <label>import questions from a file</label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Excel/CSV columns: question (required), type, required, options, help text, page. unrecognized
            types default to short text. Word (.docx): one question per line, optionally ending in a type
            hint like "how satisfied are you? (rating)".
          </p>
          <input
            ref={fileInputRef}
            id="excel-import-input"
            type="file"
            accept=".xlsx,.xls,.csv,.docx"
            onChange={onImportExcel}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'reading file…' : 'import from Excel, CSV, or Word'}
          </button>
          {importIssues.length > 0 && (
            <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
              {importIssues.slice(0, 5).map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
              {importIssues.length > 5 && <li>…and {importIssues.length - 5} more</li>}
            </ul>
          )}
        </div>

        {fields.length > 0 && (
          <div className="page-title-row" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFields((current) => current.map((f) => ({ ...f, required: true })))}
            >
              mark all required
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFields((current) => current.map((f) => ({ ...f, required: false })))}
            >
              mark all optional
            </button>
          </div>
        )}

        {fields.map((field, index) => (
          <fieldset key={index} className="builder-field question-card">
            <legend>
              <span className="question-number">{index + 1}.</span> question
            </legend>

            <label htmlFor={`field-label-${index}`}>field label</label>
            <input
              id={`field-label-${index}`}
              value={field.label}
              onChange={(e) => updateField(index, { label: e.target.value })}
            />

            <label htmlFor={`field-help-${index}`}>help text (optional)</label>
            <input
              id={`field-help-${index}`}
              value={field.helpText}
              onChange={(e) => updateField(index, { helpText: e.target.value })}
              placeholder="shown under the question"
            />
            {keyedFields.slice(0, index).length > 0 && (
              <p className="muted" style={{ fontSize: 11, margin: '2px 0 8px' }}>
                pipe an earlier answer into the label or help text with{' '}
                {keyedFields
                  .slice(0, index)
                  .map((f) => (
                    <code key={f.key} style={{ marginRight: 4 }}>
                      {`{{${f.key}}}`}
                    </code>
                  ))}
              </p>
            )}

            <label htmlFor={`field-type-${index}`}>field type</label>
            <select
              id={`field-type-${index}`}
              value={field.type}
              onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
            >
              {FIELD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {field.type !== 'section_header' && (
              <>
                <label htmlFor={`field-media-type-${index}`}>question media (optional)</label>
                <select
                  id={`field-media-type-${index}`}
                  value={field.mediaType}
                  onChange={(e) => updateField(index, { mediaType: e.target.value as DraftField['mediaType'] })}
                >
                  <option value="none">none</option>
                  <option value="image">image</option>
                  <option value="video">video (embed URL)</option>
                </select>
                {field.mediaType === 'image' && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files?.[0] && onUploadFieldMedia(index, e.target.files[0])}
                    />
                    {field.mediaAssetId && (
                      <img src={assetUrl(field.mediaAssetId)} alt="" className="option-image" />
                    )}
                  </>
                )}
                {field.mediaType === 'video' && (
                  <input
                    value={field.mediaUrl}
                    onChange={(e) => updateField(index, { mediaUrl: e.target.value })}
                    placeholder="https://www.youtube.com/embed/…"
                  />
                )}
              </>
            )}

            {(() => {
              const earlierFields = keyedFields.slice(0, index).filter((f) => f.type !== 'section_header');
              const visibleWhenTarget = earlierFields.find((f) => f.key === field.visibleWhenFieldKey);
              return (
                <>
                  <label htmlFor={`field-visible-field-${index}`}>show only if (optional)</label>
                  <select
                    id={`field-visible-field-${index}`}
                    value={field.visibleWhenFieldKey}
                    onChange={(e) => updateField(index, { visibleWhenFieldKey: e.target.value, visibleWhenValue: '' })}
                    disabled={earlierFields.length === 0}
                  >
                    <option value="">always visible</option>
                    {earlierFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.type})
                      </option>
                    ))}
                  </select>

                  {field.visibleWhenFieldKey && (
                    <>
                      <label htmlFor={`field-visible-op-${index}`}>condition</label>
                      <select
                        id={`field-visible-op-${index}`}
                        value={field.visibleWhenOperator}
                        onChange={(e) => updateField(index, { visibleWhenOperator: e.target.value as ConditionOperator })}
                      >
                        {CONDITION_OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op.replace('_', ' ')}
                          </option>
                        ))}
                      </select>

                      <label htmlFor={`field-visible-value-${index}`}>value</label>
                      {visibleWhenTarget?.type === 'boolean' ? (
                        <select
                          id={`field-visible-value-${index}`}
                          value={field.visibleWhenValue}
                          onChange={(e) => updateField(index, { visibleWhenValue: e.target.value })}
                        >
                          <option value="">choose…</option>
                          <option value="true">yes</option>
                          <option value="false">no</option>
                        </select>
                      ) : (
                        <input
                          id={`field-visible-value-${index}`}
                          value={field.visibleWhenValue}
                          onChange={(e) => updateField(index, { visibleWhenValue: e.target.value })}
                          placeholder={
                            visibleWhenTarget?.type === 'select' || visibleWhenTarget?.type === 'multi_select'
                              ? 'exact option value'
                              : 'exact value to match'
                          }
                        />
                      )}
                    </>
                  )}
                </>
              );
            })()}

            {field.type !== 'section_header' && (
              <>
                <label htmlFor={`field-captured-param-${index}`}>capture from URL parameter (optional)</label>
                <input
                  id={`field-captured-param-${index}`}
                  value={field.capturedFromUrlParam}
                  onChange={(e) => updateField(index, { capturedFromUrlParam: e.target.value })}
                  placeholder="e.g. utm_source — never shown to the respondent when set"
                />
              </>
            )}

            {(field.type === 'select' || field.type === 'multi_select' || field.type === 'ranking') && (
              <>
                <label htmlFor={`field-options-${index}`}>options (comma-separated)</label>
                <input
                  id={`field-options-${index}`}
                  value={field.options}
                  onChange={(e) => updateField(index, { options: e.target.value })}
                  placeholder="red, amber, green"
                />
                <span className="builder-required">
                  <input
                    id={`field-shuffle-${index}`}
                    type="checkbox"
                    checked={field.shuffleOptions}
                    onChange={(e) => updateField(index, { shuffleOptions: e.target.checked })}
                  />
                  <label htmlFor={`field-shuffle-${index}`}>
                    {field.type === 'ranking' ? 'randomize starting order' : 'shuffle option order per respondent'}
                  </label>
                </span>
                {parseList(field.options).length > 0 && (
                  <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>option images (optional)</span>
                    {parseList(field.options).map((optionValue) => (
                      <div key={optionValue} className="builder-required" style={{ marginTop: 4 }}>
                        <span style={{ minWidth: 100, display: 'inline-block' }}>{optionValue}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => e.target.files?.[0] && onUploadOptionImage(index, optionValue, e.target.files[0])}
                        />
                        {field.optionImages[optionValue] && (
                          <img src={assetUrl(field.optionImages[optionValue]!)} alt="" className="option-image" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {field.type === 'select' && (
              <>
                <label htmlFor={`field-layout-${index}`}>layout</label>
                <select
                  id={`field-layout-${index}`}
                  value={field.layout}
                  onChange={(e) => updateField(index, { layout: e.target.value as 'dropdown' | 'radio' })}
                >
                  <option value="dropdown">dropdown</option>
                  <option value="radio">radio buttons</option>
                </select>
                <span className="builder-required">
                  <input
                    id={`field-other-${index}`}
                    type="checkbox"
                    checked={field.allowOther}
                    onChange={(e) => updateField(index, { allowOther: e.target.checked })}
                  />
                  <label htmlFor={`field-other-${index}`}>allow "other" free-text answer</label>
                </span>
              </>
            )}

            {(field.type === 'select' ||
              field.type === 'multi_select' ||
              field.type === 'boolean' ||
              field.type === 'short_text' ||
              field.type === 'number') && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>quiz: correct answer (optional)</span>

                {field.type === 'select' && (
                  <>
                    <label htmlFor={`field-correct-${index}`}>correct option</label>
                    <select
                      id={`field-correct-${index}`}
                      value={field.correctValue}
                      onChange={(e) => updateField(index, { correctValue: e.target.value })}
                    >
                      <option value="">not graded</option>
                      {parseList(field.options).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {field.type === 'multi_select' && (
                  <>
                    <label htmlFor={`field-correct-${index}`}>correct options (comma-separated, exact set)</label>
                    <input
                      id={`field-correct-${index}`}
                      value={field.correctValues}
                      onChange={(e) => updateField(index, { correctValues: e.target.value })}
                      placeholder="leave blank for not graded"
                    />
                  </>
                )}

                {field.type === 'boolean' && (
                  <>
                    <label htmlFor={`field-correct-${index}`}>correct answer</label>
                    <select
                      id={`field-correct-${index}`}
                      value={field.correctValue}
                      onChange={(e) => updateField(index, { correctValue: e.target.value })}
                    >
                      <option value="">not graded</option>
                      <option value="true">yes</option>
                      <option value="false">no</option>
                    </select>
                  </>
                )}

                {field.type === 'short_text' && (
                  <>
                    <label htmlFor={`field-correct-${index}`}>accepted answers (comma-separated, case-insensitive)</label>
                    <input
                      id={`field-correct-${index}`}
                      value={field.correctAnswers}
                      onChange={(e) => updateField(index, { correctAnswers: e.target.value })}
                      placeholder="leave blank for not graded"
                    />
                  </>
                )}

                {field.type === 'number' && (
                  <>
                    <label htmlFor={`field-correct-${index}`}>correct value</label>
                    <input
                      id={`field-correct-${index}`}
                      type="number"
                      value={field.correctValue}
                      onChange={(e) => updateField(index, { correctValue: e.target.value })}
                      placeholder="leave blank for not graded"
                    />
                  </>
                )}

                <label htmlFor={`field-points-${index}`}>points</label>
                <input
                  id={`field-points-${index}`}
                  type="number"
                  min={0}
                  value={field.points || ''}
                  onChange={(e) => updateField(index, { points: e.target.value === '' ? 0 : Number(e.target.value) })}
                  placeholder="0"
                />

                <label htmlFor={`field-feedback-correct-${index}`}>feedback if correct (optional)</label>
                <input
                  id={`field-feedback-correct-${index}`}
                  value={field.feedbackCorrect}
                  onChange={(e) => updateField(index, { feedbackCorrect: e.target.value })}
                  placeholder="shown on the thank-you screen's feedback section"
                />

                <label htmlFor={`field-feedback-incorrect-${index}`}>feedback if incorrect (optional)</label>
                <input
                  id={`field-feedback-incorrect-${index}`}
                  value={field.feedbackIncorrect}
                  onChange={(e) => updateField(index, { feedbackIncorrect: e.target.value })}
                  placeholder="shown on the thank-you screen's feedback section"
                />
              </div>
            )}

            {field.type === 'likert' && (
              <>
                <label htmlFor={`field-options-${index}`}>statements (comma-separated)</label>
                <input
                  id={`field-options-${index}`}
                  value={field.options}
                  onChange={(e) => updateField(index, { options: e.target.value })}
                  placeholder="tooling quality, delivery pace"
                />
                <label htmlFor={`field-scale-${index}`}>scale labels (comma-separated)</label>
                <input
                  id={`field-scale-${index}`}
                  value={field.likertScale}
                  onChange={(e) => updateField(index, { likertScale: e.target.value })}
                  placeholder="disagree, neutral, agree"
                />
              </>
            )}

            {field.type === 'file' && (
              <>
                <label htmlFor={`field-mime-${index}`}>accepted file types (comma-separated MIME types)</label>
                <input
                  id={`field-mime-${index}`}
                  value={field.acceptedMimeTypes}
                  onChange={(e) => updateField(index, { acceptedMimeTypes: e.target.value })}
                  placeholder="application/pdf, image/png, image/jpeg"
                />
                <label htmlFor={`field-maxsize-${index}`}>max file size (MB, up to 25)</label>
                <input
                  id={`field-maxsize-${index}`}
                  type="number"
                  min={1}
                  max={25}
                  value={field.maxSizeMb}
                  onChange={(e) => updateField(index, { maxSizeMb: Number(e.target.value) })}
                />
                <label htmlFor={`field-maxfiles-${index}`}>max number of files (up to 10)</label>
                <input
                  id={`field-maxfiles-${index}`}
                  type="number"
                  min={1}
                  max={10}
                  value={field.maxFiles}
                  onChange={(e) => updateField(index, { maxFiles: Number(e.target.value) })}
                />
              </>
            )}

            {field.type === 'rating' && (
              <>
                <label htmlFor={`field-scale-n-${index}`}>scale (2–10)</label>
                <input
                  id={`field-scale-n-${index}`}
                  type="number"
                  min={2}
                  max={10}
                  value={field.scale}
                  onChange={(e) => updateField(index, { scale: Number(e.target.value) })}
                />
                <label htmlFor={`field-rating-style-${index}`}>style</label>
                <select
                  id={`field-rating-style-${index}`}
                  value={field.ratingStyle}
                  onChange={(e) => updateField(index, { ratingStyle: e.target.value as 'pills' | 'stars' })}
                >
                  <option value="pills">numbered pills</option>
                  <option value="stars">stars</option>
                </select>
              </>
            )}

            {field.type === 'slider' && (
              <>
                <label htmlFor={`field-slider-min-${index}`}>minimum</label>
                <input
                  id={`field-slider-min-${index}`}
                  type="number"
                  value={field.sliderMin}
                  onChange={(e) => updateField(index, { sliderMin: Number(e.target.value) })}
                />
                <label htmlFor={`field-slider-max-${index}`}>maximum</label>
                <input
                  id={`field-slider-max-${index}`}
                  type="number"
                  value={field.sliderMax}
                  onChange={(e) => updateField(index, { sliderMax: Number(e.target.value) })}
                />
                <label htmlFor={`field-slider-step-${index}`}>step</label>
                <input
                  id={`field-slider-step-${index}`}
                  type="number"
                  min={0.01}
                  value={field.sliderStep}
                  onChange={(e) => updateField(index, { sliderStep: Number(e.target.value) })}
                />
              </>
            )}

            {(field.type === 'rating' || field.type === 'nps' || field.type === 'slider') && (
              <>
                <label htmlFor={`field-low-${index}`}>low-end label (optional)</label>
                <input
                  id={`field-low-${index}`}
                  value={field.lowLabel}
                  onChange={(e) => updateField(index, { lowLabel: e.target.value })}
                  placeholder="not likely"
                />
                <label htmlFor={`field-high-${index}`}>high-end label (optional)</label>
                <input
                  id={`field-high-${index}`}
                  value={field.highLabel}
                  onChange={(e) => updateField(index, { highLabel: e.target.value })}
                  placeholder="extremely likely"
                />
              </>
            )}

            {(field.type === 'short_text' || field.type === 'long_text') && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>response validation (optional)</span>
                <label htmlFor={`field-minlen-${index}`}>minimum length</label>
                <input
                  id={`field-minlen-${index}`}
                  type="number"
                  min={0}
                  value={field.minLength || ''}
                  onChange={(e) => updateField(index, { minLength: e.target.value === '' ? 0 : Number(e.target.value) })}
                  placeholder="no minimum"
                />
                <label htmlFor={`field-pattern-${index}`}>must match pattern (regex, optional)</label>
                <input
                  id={`field-pattern-${index}`}
                  value={field.pattern}
                  onChange={(e) => updateField(index, { pattern: e.target.value })}
                  placeholder="e.g. ^[A-Z]{2}\\d{4}$"
                />
                {field.pattern && (
                  <>
                    <label htmlFor={`field-pattern-msg-${index}`}>error message when it doesn't match</label>
                    <input
                      id={`field-pattern-msg-${index}`}
                      value={field.patternErrorMessage}
                      onChange={(e) => updateField(index, { patternErrorMessage: e.target.value })}
                      placeholder="please enter a valid value"
                    />
                  </>
                )}
              </div>
            )}

            {field.type === 'contact_info' && (
              <>
                <span className="builder-required">
                  <input
                    id={`field-req-name-${index}`}
                    type="checkbox"
                    checked={field.requireName}
                    onChange={(e) => updateField(index, { requireName: e.target.checked })}
                  />
                  <label htmlFor={`field-req-name-${index}`}>require name</label>
                </span>
                <span className="builder-required">
                  <input
                    id={`field-req-email-${index}`}
                    type="checkbox"
                    checked={field.requireEmail}
                    onChange={(e) => updateField(index, { requireEmail: e.target.checked })}
                  />
                  <label htmlFor={`field-req-email-${index}`}>require email</label>
                </span>
                <span className="builder-required">
                  <input
                    id={`field-req-phone-${index}`}
                    type="checkbox"
                    checked={field.requirePhone}
                    onChange={(e) => updateField(index, { requirePhone: e.target.checked })}
                  />
                  <label htmlFor={`field-req-phone-${index}`}>require phone</label>
                </span>
              </>
            )}

            {field.type === 'hot_spot' && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <label htmlFor={`field-hotspot-image-${index}`}>image</label>
                <input
                  id={`field-hotspot-image-${index}`}
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    e.target.files?.[0] &&
                    uploadAsset<{ id: string }>(e.target.files[0]).then((uploaded) =>
                      updateField(index, { hotSpotAssetId: uploaded.id }),
                    )
                  }
                />
                {field.hotSpotAssetId && (
                  <img src={assetUrl(field.hotSpotAssetId)} alt="" className="option-image" style={{ maxWidth: 240 }} />
                )}
                <span className="muted" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                  regions (x/y/width/height as % of the image)
                </span>
                {field.hotSpotRegions.map((region, ri) => (
                  <div key={ri} className="builder-required" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    <input
                      aria-label="region label"
                      value={region.label}
                      placeholder="label"
                      style={{ width: 100 }}
                      onChange={(e) => {
                        const next = [...field.hotSpotRegions];
                        next[ri] = { ...next[ri]!, label: e.target.value, value: e.target.value };
                        updateField(index, { hotSpotRegions: next });
                      }}
                    />
                    {(['x', 'y', 'width', 'height'] as const).map((axis) => (
                      <input
                        key={axis}
                        aria-label={axis}
                        type="number"
                        min={0}
                        max={100}
                        value={region[axis]}
                        placeholder={axis}
                        style={{ width: 60 }}
                        onChange={(e) => {
                          const next = [...field.hotSpotRegions];
                          next[ri] = { ...next[ri]!, [axis]: Number(e.target.value) };
                          updateField(index, { hotSpotRegions: next });
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        updateField(index, { hotSpotRegions: field.hotSpotRegions.filter((_, i) => i !== ri) })
                      }
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ marginTop: 4 }}
                  onClick={() =>
                    updateField(index, {
                      hotSpotRegions: [
                        ...field.hotSpotRegions,
                        { value: `region_${field.hotSpotRegions.length + 1}`, label: `region ${field.hotSpotRegions.length + 1}`, x: 10, y: 10, width: 20, height: 20 },
                      ],
                    })
                  }
                >
                  + add region
                </button>
              </div>
            )}

            {field.type !== 'section_header' && (
              <span className="builder-required">
                <input
                  id={`field-required-${index}`}
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                />
                <label htmlFor={`field-required-${index}`}>required</label>
              </span>
            )}

            <div className="builder-field-actions">
              <button type="button" className="btn-ghost" aria-label={`move question ${index + 1} up`}
                disabled={index === 0} onClick={() => moveField(index, -1)}>
                ↑ move up
              </button>
              <button type="button" className="btn-ghost" aria-label={`move question ${index + 1} down`}
                disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}>
                ↓ move down
              </button>
              <button type="button" className="btn-ghost" onClick={() => duplicateField(index)}>
                duplicate
              </button>
              {sectionsEnabled && (
                <button type="button" className="btn-ghost" onClick={() => splitPageHere(index)}>
                  ⏎ split into a new page here
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
              >
                remove field
              </button>
            </div>
          </fieldset>
        ))}

        <button
          type="button"
          className="msform-add-field"
          onClick={() => setFields((current) => [...current, emptyField()])}
        >
          + add field
        </button>

        <div className="admin-card" style={{ marginTop: 24, marginBottom: 16 }}>
          <span className="builder-required">
            <input
              id="sections-toggle"
              type="checkbox"
              checked={sectionsEnabled}
              onChange={(e) => {
                setSectionsEnabled(e.target.checked);
                if (e.target.checked && sections.length === 0) setSections([emptySection(0)]);
              }}
            />
            <label htmlFor="sections-toggle">split into pages, with branching</label>
          </span>

          {sectionsEnabled && (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                assign every question to a page. optionally, branch a page's ending on a "choice" question's
                answer — jumps only reach a LATER page, or end the form early.
              </p>

              {unassignedFieldKeys.length > 0 && (
                <p className="form-error">
                  not yet assigned to a page:{' '}
                  {unassignedFieldKeys.map((k) => keyedFields.find((f) => f.key === k)?.label).join(', ')}
                </p>
              )}

              {sections.map((section, index) => {
                const laterSections = sections.slice(index + 1);
                const triggerCandidates = keyedFields.filter(
                  (f) => BRANCH_TRIGGER_TYPES.includes(f.type) && section.fieldKeys.includes(f.key),
                );

                return (
                  <fieldset key={section.id} className="question-card" style={{ marginBottom: 12 }}>
                    <legend>page {index + 1}</legend>

                    <label htmlFor={`section-title-${index}`}>page title (optional)</label>
                    <input
                      id={`section-title-${index}`}
                      value={section.title}
                      onChange={(e) => updateSection(index, { title: e.target.value })}
                      placeholder={section.id}
                    />

                    <label htmlFor={`section-description-${index}`}>page description (optional)</label>
                    <input
                      id={`section-description-${index}`}
                      value={section.description}
                      onChange={(e) => updateSection(index, { description: e.target.value })}
                      placeholder="shown under the page title"
                    />

                    <label htmlFor={`section-media-type-${index}`}>page media (optional)</label>
                    <select
                      id={`section-media-type-${index}`}
                      value={section.mediaType}
                      onChange={(e) => updateSection(index, { mediaType: e.target.value as DraftSection['mediaType'] })}
                    >
                      <option value="none">none</option>
                      <option value="image">image</option>
                      <option value="video">video (embed URL)</option>
                    </select>
                    {section.mediaType === 'image' && (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => e.target.files?.[0] && onUploadSectionMedia(index, e.target.files[0])}
                        />
                        {section.mediaAssetId && (
                          <img src={assetUrl(section.mediaAssetId)} alt="" className="option-image" />
                        )}
                      </>
                    )}
                    {section.mediaType === 'video' && (
                      <input
                        value={section.mediaUrl}
                        onChange={(e) => updateSection(index, { mediaUrl: e.target.value })}
                        placeholder="https://www.youtube.com/embed/…"
                      />
                    )}

                    <label>questions on this page</label>
                    <div className="perm-grid">
                      {keyedFields.length === 0 && <span className="muted">add questions above first.</span>}
                      {keyedFields.map((f) => (
                        <span key={f.key} className="builder-required">
                          <input
                            id={`section-${index}-${f.key}`}
                            type="checkbox"
                            checked={section.fieldKeys.includes(f.key)}
                            onChange={() => toggleFieldInSection(index, f.key)}
                          />
                          <label htmlFor={`section-${index}-${f.key}`}>{f.label}</label>
                        </span>
                      ))}
                    </div>

                    {laterSections.length > 0 && (
                      <>
                        <label>branch rules (optional — a page can have more than one)</label>
                        {section.branchRules.map((rule, ruleIndex) => {
                          const trigger = triggerCandidates.find((f) => f.key === rule.fieldKey);
                          const enumerable = caseKeysFor(trigger) !== null;
                          return (
                            <div key={ruleIndex} className="admin-card" style={{ padding: 10, marginTop: 8 }}>
                              <label htmlFor={`section-trigger-${index}-${ruleIndex}`}>branch on</label>
                              <select
                                id={`section-trigger-${index}-${ruleIndex}`}
                                value={rule.fieldKey}
                                onChange={(e) => {
                                  const next = triggerCandidates.find((f) => f.key === e.target.value);
                                  onTriggerFieldChange(index, ruleIndex, e.target.value, caseKeysFor(next));
                                }}
                              >
                                <option value="">choose a question</option>
                                {triggerCandidates.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label} ({f.type})
                                  </option>
                                ))}
                              </select>

                              {trigger?.type === 'likert' && (
                                <>
                                  <label htmlFor={`section-statement-${index}-${ruleIndex}`}>
                                    which statement drives the branch
                                  </label>
                                  <select
                                    id={`section-statement-${index}-${ruleIndex}`}
                                    value={rule.statement}
                                    onChange={(e) => onStatementChange(index, ruleIndex, e.target.value, trigger.likertScale)}
                                  >
                                    <option value="">choose a statement</option>
                                    {trigger.options.map((st) => (
                                      <option key={st} value={st}>
                                        {st}
                                      </option>
                                    ))}
                                  </select>
                                </>
                              )}

                              {trigger && (trigger.type !== 'likert' || rule.statement) && (
                                enumerable ? (
                                  rule.cases.map((c, ci) => (
                                    <div key={c.equals}>
                                      <label htmlFor={`section-case-${index}-${ruleIndex}-${ci}`}>
                                        if {trigger.type === 'multi_select' ? 'selections include' : 'answer is'} "
                                        {caseLabelOf(trigger, c.equals)}" go to
                                      </label>
                                      <select
                                        id={`section-case-${index}-${ruleIndex}-${ci}`}
                                        value={c.goTo}
                                        onChange={(e) => updateCase(index, ruleIndex, ci, { goTo: e.target.value })}
                                      >
                                        <option value="">continue normally</option>
                                        {laterSections.map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.title.trim() || t.id}
                                          </option>
                                        ))}
                                        <option value={END_OF_FORM}>end the form</option>
                                      </select>
                                    </div>
                                  ))
                                ) : (
                                  <>
                                    {rule.cases.map((c, ci) => (
                                      <div key={ci} className="builder-required">
                                        <input
                                          value={c.equals}
                                          onChange={(e) => updateCase(index, ruleIndex, ci, { equals: e.target.value })}
                                          placeholder="exact answer to match"
                                        />
                                        <select
                                          value={c.goTo}
                                          onChange={(e) => updateCase(index, ruleIndex, ci, { goTo: e.target.value })}
                                        >
                                          <option value="">go to…</option>
                                          {laterSections.map((t) => (
                                            <option key={t.id} value={t.id}>
                                              {t.title.trim() || t.id}
                                            </option>
                                          ))}
                                          <option value={END_OF_FORM}>end the form</option>
                                        </select>
                                        <button
                                          type="button"
                                          className="btn-ghost"
                                          onClick={() => removeCase(index, ruleIndex, ci)}
                                        >
                                          remove case
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() => addManualCase(index, ruleIndex)}
                                    >
                                      + add case
                                    </button>
                                  </>
                                )
                              )}

                              <label htmlFor={`section-default-${index}-${ruleIndex}`}>
                                {trigger ? 'if none of the above match' : 'always jump to (unconditional)'}
                              </label>
                              <select
                                id={`section-default-${index}-${ruleIndex}`}
                                value={rule.defaultGoTo}
                                onChange={(e) => updateBranchRule(index, ruleIndex, { defaultGoTo: e.target.value })}
                              >
                                <option value="">continue to the next page</option>
                                {laterSections.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.title.trim() || t.id}
                                  </option>
                                ))}
                                <option value={END_OF_FORM}>end the form</option>
                              </select>

                              <div className="builder-field-actions">
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => removeBranchRule(index, ruleIndex)}
                                >
                                  remove this rule
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <button type="button" className="btn-ghost" onClick={() => addBranchRule(index)}>
                          + add branch rule
                        </button>
                      </>
                    )}

                    <div className="builder-field-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={index === 0}
                        onClick={() => moveSection(index, -1)}
                      >
                        ↑ move up
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={index === sections.length - 1}
                        onClick={() => moveSection(index, 1)}
                      >
                        ↓ move down
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setSections((current) => current.filter((_, i) => i !== index))}
                      >
                        remove page
                      </button>
                    </div>
                  </fieldset>
                );
              })}

              <button type="button" className="msform-add-field" onClick={addSection}>
                + add page
              </button>
            </>
          )}
        </div>

        <div className="admin-card" style={{ marginTop: 24, marginBottom: 16 }}>
          <label>look &amp; feel (optional)</label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            accent color for the banner, buttons, and selected answers — falls back to the pulse brand purple.
          </p>
          <div className="page-title-row" style={{ marginTop: 8 }}>
            {THEME_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`use accent color ${color}`}
                onClick={() => setThemeAccentColor(color)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: color,
                  border: themeAccentColor === color ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
              />
            ))}
            <input
              type="color"
              aria-label="custom accent color"
              value={themeAccentColor || '#4f008c'}
              onChange={(e) => setThemeAccentColor(e.target.value)}
            />
            {themeAccentColor && (
              <button type="button" className="btn-ghost" onClick={() => setThemeAccentColor('')}>
                reset to default
              </button>
            )}
          </div>

          <label htmlFor="theme-font">font (optional)</label>
          <select
            id="theme-font"
            value={themeFontFamily}
            onChange={(e) => setThemeFontFamily(e.target.value as typeof themeFontFamily)}
          >
            <option value="">default (app font)</option>
            {FORM_FONT_FAMILIES.filter((f) => f !== 'default').map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <label htmlFor="theme-logo">logo (optional)</label>
          <input
            id="theme-logo"
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && onUploadThemeLogo(e.target.files[0])}
          />
          {themeLogoAssetId && <img src={assetUrl(themeLogoAssetId)} alt="" className="option-image" />}

          <label htmlFor="theme-background">banner background image (optional)</label>
          <input
            id="theme-background"
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && onUploadThemeBackground(e.target.files[0])}
          />
          {themeBackgroundAssetId && <img src={assetUrl(themeBackgroundAssetId)} alt="" className="option-image" />}
        </div>

        <div className="page-title-row">
          <button
            type="button"
            className="btn-primary"
            onClick={onPublish}
            disabled={
              !title.trim() ||
              fields.length === 0 ||
              fields.some((f) => !f.label.trim()) ||
              (sectionsEnabled &&
                (unassignedFieldKeys.length > 0 || sections.some((s) => s.fieldKeys.length === 0)))
            }
          >
            publish
          </button>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        </div>
      </div>
    </PortalShell>
  );
}
