'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CONDITION_OPERATORS,
  SCORE_FIELD_TYPES,
  type FieldType,
  type FormDefinition,
  type FormField,
} from '@pulse/contracts';

type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
import { PortalShell, can } from '../../../components/portal-shell';
import { KpiLinkCombobox } from '../../../components/kpi-link-combobox';
import { LoadingState } from '../../../components/loading-state';
import { api, assetUrl, uploadAsset } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'short_text', label: 'short text' },
  { value: 'long_text', label: 'long text' },
  { value: 'number', label: 'number' },
  { value: 'date', label: 'date' },
  { value: 'time', label: 'time' },
  { value: 'boolean', label: 'yes / no' },
  { value: 'rating', label: 'rating (2–10)' },
  { value: 'nps', label: 'net promoter score (0–10)' },
  { value: 'select', label: 'choice (one answer)' },
  { value: 'multi_select', label: 'choice (multiple answers)' },
  { value: 'likert', label: 'likert matrix' },
  { value: 'grid', label: 'grid (multiple choice / checkbox)' },
  { value: 'ranking', label: 'ranking' },
  { value: 'file', label: 'file upload' },
  { value: 'section_header', label: 'section heading (no answer)' },
  { value: 'slider', label: 'slider' },
  { value: 'contact_info', label: 'contact info (name / email / phone)' },
  { value: 'hot_spot', label: 'hot spot (click a region on an image)' },
];

const FIELD_TYPE_ICON: Record<FieldType, string> = {
  short_text: '—',
  long_text: '☰',
  number: '#',
  date: '📅',
  time: '🕐',
  boolean: '◐',
  rating: '★',
  nps: '📊',
  select: '◉',
  multi_select: '☑',
  likert: '▤',
  grid: '▦',
  ranking: '↕',
  file: '📎',
  section_header: 'Tt',
  slider: '🎚',
  contact_info: '👤',
  hot_spot: '⌖',
  person: '🧑',
};

const parseList = (raw: string) =>
  raw.split(',').map((s) => s.trim()).filter(Boolean);

interface DraftField {
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

const emptyField = (): DraftField => ({
  label: '',
  helpText: '',
  type: 'short_text',
  required: false,
  options: '',
  layout: 'radio',
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
  gridRows: '',
  gridColumns: '',
  gridSelection: 'single',
  gridRequireOnePerRow: false,
  capturedFromUrlParam: '',
  kpiId: '',
  evaluationAreaId: '',
  kpiMappingId: '',
});

// fieldKey is capped at 64 chars server-side (packages/contracts/src/form-schema.ts) — long
// question labels (common in imported QA evaluation forms) must be truncated, not rejected.
const toKey = (label: string, index: number) => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/, '');
  return (/^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`).slice(0, 64);
};

interface KpiOption {
  id: string;
  name: string;
  evaluationAreas: Array<{ id: string; name: string; cadence: string; isActive: boolean }>;
}

interface KeyedField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  scale: number;
  likertScale: string[];
}

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
    key: draft.key ?? toKey(draft.label, index),
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
        allowOther: draft.allowOther,
        ...(draft.points > 0 && draft.correctValues.trim()
          ? { correctValues: parseList(draft.correctValues), ...quizPoints, ...quizFeedback }
          : {}),
      };
    }
    case 'grid': {
      const toOptionItems = (values: string[]) => values.map((v) => ({ value: v, label: v }));
      return {
        ...base,
        type: draft.type,
        rows: toOptionItems(parseList(draft.gridRows)),
        columns: toOptionItems(parseList(draft.gridColumns)),
        selection: draft.gridSelection,
        requireOnePerRow: draft.gridRequireOnePerRow,
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

/** Reverses toDefinitionField for edit mode: rebuilds a DraftField from a
 *  saved FormField, pinning `key` so a republish doesn't regenerate it (see
 *  DraftField.key). Options/statements collapse label back to value — this
 *  builder never lets label and value diverge, so nothing is lost for any
 *  form actually authored through it. */
function fromDefinitionField(field: FormField): DraftField {
  const draft = emptyField();
  draft.key = field.key;
  draft.label = field.label;
  draft.helpText = field.helpText ?? '';
  draft.type = field.type;
  draft.required = field.required;
  draft.capturedFromUrlParam = field.capturedFromUrlParam ?? '';

  if (field.media?.type === 'image') {
    draft.mediaType = 'image';
    draft.mediaAssetId = field.media.assetId ?? '';
    draft.mediaAlt = field.media.alt ?? '';
  } else if (field.media?.type === 'video') {
    draft.mediaType = 'video';
    draft.mediaUrl = field.media.url ?? '';
    draft.mediaAlt = field.media.alt ?? '';
  }

  if (field.visibleWhen) {
    draft.visibleWhenFieldKey = field.visibleWhen.fieldKey;
    draft.visibleWhenOperator = field.visibleWhen.operator;
    draft.visibleWhenValue = String(field.visibleWhen.equals);
  }

  const optionsToDraft = (options: Array<{ value: string; imageAssetId?: string }>) => {
    draft.options = options.map((o) => o.value).join(', ');
    draft.optionImages = Object.fromEntries(
      options.filter((o) => o.imageAssetId).map((o) => [o.value, o.imageAssetId!]),
    );
  };

  switch (field.type) {
    case 'select':
      optionsToDraft(field.options);
      draft.layout = field.layout;
      draft.allowOther = field.allowOther;
      draft.shuffleOptions = field.shuffleOptions;
      if (field.correctValue !== undefined) {
        draft.correctValue = field.correctValue;
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    case 'multi_select':
      optionsToDraft(field.options);
      draft.shuffleOptions = field.shuffleOptions;
      draft.allowOther = field.allowOther;
      if (field.correctValues) {
        draft.correctValues = field.correctValues.join(', ');
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    case 'boolean':
      if (field.correctValue !== undefined) {
        draft.correctValue = field.correctValue ? 'true' : 'false';
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    case 'short_text':
      draft.minLength = field.minLength ?? 0;
      draft.pattern = field.pattern ?? '';
      draft.patternErrorMessage = field.patternErrorMessage ?? '';
      if (field.correctAnswers) {
        draft.correctAnswers = field.correctAnswers.join(', ');
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    case 'long_text':
      draft.minLength = field.minLength ?? 0;
      draft.pattern = field.pattern ?? '';
      draft.patternErrorMessage = field.patternErrorMessage ?? '';
      break;
    case 'number':
      if (field.correctValue !== undefined) {
        draft.correctValue = String(field.correctValue);
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    case 'ranking':
      optionsToDraft(field.options);
      draft.shuffleOptions = field.shuffleOptions;
      break;
    case 'likert':
      draft.options = field.statements.map((s) => s.value).join(', ');
      draft.likertScale = field.scale.join(', ');
      break;
    case 'file':
      draft.acceptedMimeTypes = field.acceptedMimeTypes.join(', ');
      draft.maxSizeMb = field.maxSizeMb;
      draft.maxFiles = field.maxFiles;
      break;
    case 'rating':
      draft.scale = field.scale;
      draft.ratingStyle = field.style;
      draft.lowLabel = field.lowLabel ?? '';
      draft.highLabel = field.highLabel ?? '';
      break;
    case 'nps':
      draft.lowLabel = field.lowLabel ?? '';
      draft.highLabel = field.highLabel ?? '';
      break;
    case 'slider':
      draft.sliderMin = field.min;
      draft.sliderMax = field.max;
      draft.sliderStep = field.step;
      draft.lowLabel = field.lowLabel ?? '';
      draft.highLabel = field.highLabel ?? '';
      break;
    case 'contact_info':
      draft.requireName = field.requireName;
      draft.requireEmail = field.requireEmail;
      draft.requirePhone = field.requirePhone;
      break;
    case 'hot_spot':
      draft.hotSpotAssetId = field.imageAssetId;
      draft.hotSpotRegions = field.regions;
      break;
    case 'grid':
      draft.gridRows = field.rows.map((r) => r.value).join(', ');
      draft.gridColumns = field.columns.map((c) => c.value).join(', ');
      draft.gridSelection = field.selection;
      draft.gridRequireOnePerRow = field.requireOnePerRow;
      break;
    case 'date':
    case 'time':
    case 'section_header':
    case 'person':
      break;
  }
  return draft;
}

type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>;

/** A drag-sortable <fieldset> wrapper. Pulled out as its own component (not
 *  inlined in a .map()) because useSortable is a hook — it can only run once
 *  per rendered item, which means once per component instance. */
function SortableCard({
  id,
  className,
  style,
  onFocus,
  onClick,
  setRef,
  children,
}: {
  id: string | number;
  className: string;
  style?: React.CSSProperties;
  onFocus?: () => void;
  onClick?: () => void;
  setRef?: (el: HTMLFieldSetElement | null) => void;
  children: (drag: DragHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <fieldset
      ref={(el) => {
        setRef?.(el);
        setNodeRef(el);
      }}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition }}
      className={`${className}${isDragging ? ' is-dragging' : ''}`}
      onFocus={onFocus}
      onClick={onClick}
    >
      {children({ attributes, listeners })}
    </fieldset>
  );
}

function NewFormPage() {
  const user = useSession();
  const router = useRouter();
  const editSlug = useSearchParams().get('edit');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [activeFieldIndex, setActiveFieldIndex] = useState<number | null>(null);
  const fieldRefs = useRef<Array<HTMLFieldSetElement | null>>([]);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ slug: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set once the existing form has loaded — id/slug drive the publishNewVersion
  // call instead of createForm; null means "creating a new form" (or, while
  // editSlug is set but the fetch hasn't resolved yet, "still loading").
  const [editingForm, setEditingForm] = useState<{ id: string; slug: string } | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editSlug));
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [kpiLinkErrors, setKpiLinkErrors] = useState<Record<number, string>>({});
  // Explicit ⋮-menu overrides for the "link to KPI" panel's open/closed state — see kpiOpen below.
  const [kpiPanelOverrides, setKpiPanelOverrides] = useState<Map<number, boolean>>(new Map());

  useEffect(() => {
    api<KpiOption[]>('/v1/kpis?pageSize=100').then(setKpis).catch(() => setKpis([]));
  }, []);

  useEffect(() => {
    if (!editSlug) return;
    let cancelled = false;
    setLoadingExisting(true);
    api<{ form: { id: string; slug: string }; definition: FormDefinition }>(
      `/v1/forms/${encodeURIComponent(editSlug)}`,
    )
      .then(async ({ form, definition }) => {
        if (cancelled) return;
        setEditingForm({ id: form.id, slug: form.slug });
        setTitle(definition.title);
        setDescription(definition.description ?? '');
        setFields(definition.fields.map(fromDefinitionField));
        // hydrate any existing per-question KPI links — best-effort, a
        // failure here just means the inline pickers start unlinked instead
        // of blocking the whole form load
        try {
          const mappings = await api<
            Array<{ id: string; evaluationAreaId: string; scoreFieldKey: string; evaluationArea: { kpiId: string } }>
          >(`/v1/forms/${form.id}/kpi-mappings`);
          if (cancelled) return;
          setFields((current) =>
            current.map((f, i) => {
              const key = f.key ?? toKey(f.label, i);
              const match = mappings.find((m) => m.scoreFieldKey === key);
              return match
                ? { ...f, kpiId: match.evaluationArea.kpiId, evaluationAreaId: match.evaluationAreaId, kpiMappingId: match.id }
                : f;
            }),
          );
        } catch {
          // non-fatal, see above
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'could not load this form');
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editSlug]);

  const keyedFields = fields.map((f, i) => ({
    key: f.key ?? toKey(f.label, i),
    label: f.label.trim() || `question ${i + 1}`,
    type: f.type,
    options: parseList(f.options),
    scale: f.scale,
    likertScale: parseList(f.likertScale),
  }));
  const canLinkKpis = can(user, 'forms:manage') && can(user, 'kpis:write');

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function toggleKpiPanel(index: number, open: boolean) {
    setKpiPanelOverrides((current) => new Map(current).set(index, open));
  }

  /** Picking a KPI + evaluation area for a question. On an existing form
   *  (formId already known) this creates/replaces the real FormKpiMapping
   *  immediately — same as the settings-tab panel, just one click closer to
   *  the question itself. On a brand-new form there's no formId yet, so the
   *  choice is only staged locally; createPendingKpiLinks turns it into real
   *  mappings right after the form is created (see onPublish). */
  function setKpiLinkError(index: number, message: string | null) {
    setKpiLinkErrors((current) => {
      if (message === null) {
        if (!(index in current)) return current;
        const next = { ...current };
        delete next[index];
        return next;
      }
      return { ...current, [index]: message };
    });
  }

  async function onLinkFieldToKpi(index: number, kpiId: string, evaluationAreaId: string) {
    const field = fields[index];
    const scoreFieldKey = keyedFields[index]?.key;
    if (!field || !scoreFieldKey) return;
    setKpiLinkError(index, null);

    if (!editingForm) {
      updateField(index, { kpiId, evaluationAreaId });
      return;
    }

    // A question added (or retyped) since the form was last saved doesn't
    // exist yet in the published definition the backend validates against —
    // linking it now would 422 against a field it can't find.
    if (!field.key) {
      setKpiLinkError(index, 'save the form first, then link this question to a KPI');
      return;
    }

    try {
      if (field.kpiMappingId) {
        await api(`/v1/forms/${editingForm.id}/kpi-mappings/${field.kpiMappingId}`, { method: 'DELETE' });
      }
      // No evaluatee field — every KPI link is a self-assessment (the
      // submitter scores themselves; see SubmissionsService.applyOneMapping).
      const mapping = await api<{ id: string }>(`/v1/forms/${editingForm.id}/kpi-mappings`, {
        method: 'POST',
        body: JSON.stringify({ evaluationAreaId, scoreFieldKey }),
      });
      updateField(index, { kpiId, evaluationAreaId, kpiMappingId: mapping.id });
    } catch (cause) {
      setKpiLinkError(index, cause instanceof Error ? cause.message : 'linking this question to a KPI failed');
    }
  }

  async function onUnlinkFieldFromKpi(index: number) {
    const field = fields[index];
    if (!field) return;
    setKpiLinkError(index, null);
    if (field.kpiMappingId && editingForm) {
      try {
        await api(`/v1/forms/${editingForm.id}/kpi-mappings/${field.kpiMappingId}`, { method: 'DELETE' });
      } catch (cause) {
        setKpiLinkError(index, cause instanceof Error ? cause.message : 'removing the KPI link failed');
        return;
      }
    }
    updateField(index, { kpiId: '', evaluationAreaId: '', kpiMappingId: '' });
  }

  function moveField(index: number, delta: number) {
    setFields((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setActiveFieldIndex((current) => {
      const target = index + delta;
      if (current === index) return target;
      if (current === target) return index;
      return current;
    });
  }

  function duplicateField(index: number) {
    setFields((current) => {
      const next = [...current];
      // strip the pinned key — a duplicate is a new field and must get its own
      // computed key, or it would collide with the original's stable key.
      // Also strip the KPI link: it's a real FormKpiMapping row keyed to the
      // ORIGINAL's scoreFieldKey — inheriting it here would silently point
      // the duplicate at a mapping it was never actually linked to.
      next.splice(index + 1, 0, {
        ...current[index]!,
        key: undefined,
        kpiId: '',
        evaluationAreaId: '',
        kpiMappingId: '',
      });
      return next;
    });
    setActiveFieldIndex(index + 1);
  }

  function removeField(index: number) {
    // A linked question's real FormKpiMapping row would otherwise outlive the
    // question it scored — harmless (scoring just skips a field that no
    // longer submits an answer) but orphaned, so clean it up too.
    const linkedMappingId = fields[index]?.kpiMappingId;
    if (linkedMappingId && editingForm) {
      void api(`/v1/forms/${editingForm.id}/kpi-mappings/${linkedMappingId}`, { method: 'DELETE' }).catch(() => {
        // best-effort — the field is coming out of the builder regardless
      });
    }
    setFields((current) => current.filter((_, i) => i !== index));
    setActiveFieldIndex((current) => {
      if (current === null || current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  function addField(overrides?: Partial<DraftField>) {
    setActiveFieldIndex(fields.length);
    setFields((current) => [...current, { ...emptyField(), ...overrides }]);
  }

  function reorderFieldByDrag(from: number, to: number) {
    setFields((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setActiveFieldIndex(to);
  }

  function onFieldDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    reorderFieldByDrag(Number(active.id), Number(over.id));
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

      setFields((current) => [
        ...current,
        ...parsed.map((p) => ({
          label: p.label,
          helpText: p.helpText,
          type: p.type,
          required: p.required,
          options: p.options,
          layout: 'radio' as const,
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
          gridRows: '',
          gridColumns: '',
          gridSelection: 'single' as const,
          gridRequireOnePerRow: false,
          capturedFromUrlParam: '',
          kpiId: '',
          evaluationAreaId: '',
          kpiMappingId: '',
        })),
      ]);
      setImportIssues(issues);
    } catch {
      setError('could not read this file — is it a valid .xlsx, .csv, or .docx file?');
    } finally {
      setImporting(false);
    }
  }

  /** Turns every locally-staged (kpiId, evaluationAreaId) pair into a real
   *  FormKpiMapping now that the form has a formId — only reachable on the
   *  create-a-new-form path, since editing an existing form already creates
   *  mappings immediately as they're picked (see onLinkFieldToKpi). Best-
   *  effort per field: the form itself is already published by the time this
   *  runs, so one failed link shouldn't block the redirect — it can always
   *  be added from the form's settings tab afterward. */
  async function createPendingKpiLinks(formId: string) {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!;
      if (!field.kpiId || !field.evaluationAreaId) continue;
      const scoreFieldKey = keyedFields[i]?.key;
      if (!scoreFieldKey) continue;
      try {
        await api(`/v1/forms/${formId}/kpi-mappings`, {
          method: 'POST',
          body: JSON.stringify({ evaluationAreaId: field.evaluationAreaId, scoreFieldKey }),
        });
      } catch {
        // best-effort, see above
      }
    }
  }

  async function onPublish() {
    setError(null);
    const definition = {
      title,
      ...(description.trim() ? { description: description.trim() } : {}),
      fields: fields.map((f, i) => toDefinitionField(f, i, keyedFields)),
    };
    try {
      if (editingForm) {
        await api(`/v1/forms/${editingForm.id}/versions`, {
          method: 'POST',
          body: JSON.stringify({ definition }),
        });
        router.push(`/forms/view?slug=${encodeURIComponent(editingForm.slug)}`);
        return;
      }
      const slug = `${toKey(title, 0)}-${Date.now().toString(36)}`.replace(/_/g, '-');
      const form = await api<{ id: string; slug: string }>('/v1/forms', {
        method: 'POST',
        body: JSON.stringify({ slug, definition }),
      });
      await createPendingKpiLinks(form.id);
      setPublished({ slug: form.slug });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publishing failed');
    }
  }

  if (loadingExisting) {
    return (
      <PortalShell user={user}>
        <h1>edit form</h1>
        <LoadingState />
      </PortalShell>
    );
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
          <div className="msform-edit-badge">
            <Link href={editingForm ? `/forms/view?slug=${encodeURIComponent(editingForm.slug)}` : '/forms'}>
              ← back to {editingForm ? 'form' : 'forms'}
            </Link>
            {editingForm && <span>editing an existing form — publishing saves a new version</span>}
          </div>
          <label htmlFor="form-title">form title</label>
          <Input
            id="form-title"
            className="msform-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="untitled form"
          />
          <label htmlFor="form-description" className="msform-desc-label">description (optional)</label>
          <Input
            id="form-description"
            className="msform-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="tell respondents what this form is for"
          />
        </header>

        <div className="builder msform-body">
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <label>import questions from a file</label>
          <Input
            ref={fileInputRef}
            id="excel-import-input"
            type="file"
            accept=".xlsx,.xls,.csv,.docx"
            onChange={onImportExcel}
            style={{ display: 'none' }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'reading file…' : 'import from Excel, CSV, or Word'}
          </Button>
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFields((current) => current.map((f) => ({ ...f, required: true })))}
            >
              mark all required
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFields((current) => current.map((f) => ({ ...f, required: false })))}
            >
              mark all optional
            </Button>
          </div>
        )}

        <div className="builder-fields-row">
        <div className="builder-fields-col">
        <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd}>
        <SortableContext items={fields.map((_, i) => i)} strategy={verticalListSortingStrategy}>
        {fields.map((field, index) => {
          const isActive = activeFieldIndex === index;
          // Any answerable question can be linked to a KPI — section_header is the only
          // exclusion, since it has no answer at all. Whether the link actually produces a
          // live score depends on the field type; see kpiProducesLiveScore below.
          const canLinkKpiField = field.type !== 'section_header';
          // Only these types have a well-defined 0-5 normalization (see submissions.service.ts's
          // normalizeScore) — linking any other type is allowed, but never produces a score.
          const kpiProducesLiveScore = (SCORE_FIELD_TYPES as readonly string[]).includes(field.type);
          // "link to KPI" panel visibility: an explicit toggle (via the ⋮ menu) overrides the
          // default of "open if already linked" — so an existing link stays visible without
          // requiring the toggle, but can still be tucked away once reviewed.
          const kpiOpen = kpiPanelOverrides.has(index)
            ? kpiPanelOverrides.get(index)!
            : Boolean(field.kpiId);
          return (
          <SortableCard
            key={index}
            id={index}
            className={`builder-field question-card${isActive ? ' is-active' : ''}`}
            onFocus={() => setActiveFieldIndex(index)}
            onClick={() => setActiveFieldIndex(index)}
            setRef={(el) => {
              fieldRefs.current[index] = el;
            }}
          >
          {(drag) => (
          <>
            <legend className="field-legend">
              <span className="question-number">{index + 1}</span>
            </legend>

            <Button
              type="button"
              variant="ghost"
              className="field-drag-handle"
              title="drag to reorder"
              aria-label="drag to reorder"
              {...drag.attributes}
              {...drag.listeners}
            >
              <span className="field-drag-dots">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            </Button>

            <div className="field-head-row">
              <div className="field-title-group">
                <label htmlFor={`field-label-${index}`}>field label</label>
                <Input
                  id={`field-label-${index}`}
                  className="field-title-input"
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder="untitled question"
                />
              </div>
              <div className="field-type-group">
                <label htmlFor={`field-type-${index}`}>field type</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button id={`field-type-${index}`} type="button" className="field-type-summary">
                      <span className="field-type-icon">{FIELD_TYPE_ICON[field.type]}</span>
                      <span className="field-type-summary-label">
                        {FIELD_TYPE_OPTIONS.find((option) => option.value === field.type)?.label}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent aria-label="field type">
                    {FIELD_TYPE_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        className={`field-type-option${field.type === option.value ? ' is-selected' : ''}`}
                        onSelect={() => {
                          updateField(index, { type: option.value });
                        }}
                      >
                        <span className="field-type-icon">{FIELD_TYPE_ICON[option.value]}</span>
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!isActive && (
                <Button
                  type="button"
                  variant="ghost"
                  className="field-expand-btn"
                  title="edit question"
                  aria-label="edit question"
                  onClick={() => setActiveFieldIndex(index)}
                >
                  ⌄
                </Button>
              )}
            </div>

            <div className={`field-detail-wrap${isActive ? ' is-open' : ''}`}>
            <div className="field-detail-inner">

            <label htmlFor={`field-help-${index}`}>help text (optional)</label>
            <Input
              id={`field-help-${index}`}
              value={field.helpText}
              onChange={(e) => updateField(index, { helpText: e.target.value })}
              placeholder="shown under the question"
            />
            {(field.type === 'select' || field.type === 'multi_select' || field.type === 'ranking') && (
              <>
                <label>options</label>
                <div className="option-rows">
                  {parseList(field.options).map((optionValue, optionIndex) => (
                    <div key={optionIndex} className="option-row">
                      <span
                        className={`option-row-mark${
                          field.type === 'multi_select' ? ' is-checkbox' : field.type === 'ranking' ? ' is-rank' : ''
                        }`}
                      >
                        {field.type === 'ranking' ? optionIndex + 1 : ''}
                      </span>
                      <Input
                        value={optionValue}
                        onChange={(e) => {
                          const list = parseList(field.options);
                          list[optionIndex] = e.target.value;
                          updateField(index, { options: list.join(', ') });
                        }}
                        placeholder={`Option ${optionIndex + 1}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="option-row-remove"
                        title="remove option"
                        aria-label={`remove option ${optionIndex + 1}`}
                        onClick={() => {
                          const list = parseList(field.options).filter((_, i) => i !== optionIndex);
                          updateField(index, { options: list.join(', ') });
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                  {(field.type === 'select' || field.type === 'multi_select') && field.allowOther && (
                    <div className="option-row option-row-other">
                      <span className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`} />
                      <span className="option-row-other-label">Other…</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="option-row-remove"
                        title="remove &quot;other&quot;"
                        aria-label="remove other"
                        onClick={() => updateField(index, { allowOther: false })}
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                  <div className="option-row-add-line">
                    <Button
                      type="button"
                      variant="ghost"
                      className="option-row-add"
                      onClick={() => {
                        const list = parseList(field.options);
                        list.push(`Option ${list.length + 1}`);
                        updateField(index, { options: list.join(', ') });
                      }}
                    >
                      <span className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`} />
                      add option
                    </Button>
                    {(field.type === 'select' || field.type === 'multi_select') && !field.allowOther && (
                      <>
                        {' '}or{' '}
                        <Button
                          type="button"
                          variant="ghost"
                          className="option-row-other-link"
                          onClick={() => updateField(index, { allowOther: true })}
                        >
                          add &quot;Other&quot;
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <span className="builder-required">
                  <Checkbox
                    id={`field-shuffle-${index}`}
                    checked={field.shuffleOptions}
                    onCheckedChange={(checked) => updateField(index, { shuffleOptions: checked === true })}
                  />
                  <label htmlFor={`field-shuffle-${index}`}>
                    {field.type === 'ranking' ? 'randomize starting order' : 'shuffle option order per respondent'}
                  </label>
                </span>
              </>
            )}

            {field.type === 'select' && (
              <>
                <label htmlFor={`field-layout-${index}`}>layout</label>
                <Select
                  value={field.layout}
                  onValueChange={(v) => updateField(index, { layout: v as 'dropdown' | 'radio' })}
                >
                  <SelectTrigger id={`field-layout-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dropdown">dropdown</SelectItem>
                    <SelectItem value="radio">radio buttons</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {field.type === 'likert' && (
              <>
                <label htmlFor={`field-options-${index}`}>statements (comma-separated)</label>
                <Input
                  id={`field-options-${index}`}
                  value={field.options}
                  onChange={(e) => updateField(index, { options: e.target.value })}
                  placeholder="tooling quality, delivery pace"
                />
                <label htmlFor={`field-scale-${index}`}>scale labels (comma-separated)</label>
                <Input
                  id={`field-scale-${index}`}
                  value={field.likertScale}
                  onChange={(e) => updateField(index, { likertScale: e.target.value })}
                  placeholder="disagree, neutral, agree"
                />
              </>
            )}

            {field.type === 'grid' && (
              <>
                <label htmlFor={`field-grid-rows-${index}`}>rows (comma-separated)</label>
                <Input
                  id={`field-grid-rows-${index}`}
                  value={field.gridRows}
                  onChange={(e) => updateField(index, { gridRows: e.target.value })}
                  placeholder="communication, responsiveness, quality"
                />
                <label htmlFor={`field-grid-columns-${index}`}>columns (comma-separated)</label>
                <Input
                  id={`field-grid-columns-${index}`}
                  value={field.gridColumns}
                  onChange={(e) => updateField(index, { gridColumns: e.target.value })}
                  placeholder="poor, fair, good, excellent"
                />
                <label htmlFor={`field-grid-selection-${index}`}>answers per row</label>
                <Select
                  value={field.gridSelection}
                  onValueChange={(v) => updateField(index, { gridSelection: v as 'single' | 'multiple' })}
                >
                  <SelectTrigger id={`field-grid-selection-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">one answer (multiple choice grid)</SelectItem>
                    <SelectItem value="multiple">multiple answers (checkbox grid)</SelectItem>
                  </SelectContent>
                </Select>
                <span className="builder-required">
                  <Checkbox
                    id={`field-grid-require-row-${index}`}
                    checked={field.gridRequireOnePerRow}
                    onCheckedChange={(checked) => updateField(index, { gridRequireOnePerRow: checked === true })}
                  />
                  <label htmlFor={`field-grid-require-row-${index}`}>require a response in each row</label>
                </span>
              </>
            )}

            {field.type === 'file' && (
              <>
                <label htmlFor={`field-mime-${index}`}>accepted file types (comma-separated MIME types)</label>
                <Input
                  id={`field-mime-${index}`}
                  value={field.acceptedMimeTypes}
                  onChange={(e) => updateField(index, { acceptedMimeTypes: e.target.value })}
                  placeholder="application/pdf, image/png, image/jpeg"
                />
                <label htmlFor={`field-maxsize-${index}`}>max file size (MB, up to 25)</label>
                <Input
                  id={`field-maxsize-${index}`}
                  type="number"
                  min={1}
                  max={25}
                  value={field.maxSizeMb}
                  onChange={(e) => updateField(index, { maxSizeMb: Number(e.target.value) })}
                />
                <label htmlFor={`field-maxfiles-${index}`}>max number of files (up to 10)</label>
                <Input
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
                <Input
                  id={`field-scale-n-${index}`}
                  type="number"
                  min={2}
                  max={10}
                  value={field.scale}
                  onChange={(e) => updateField(index, { scale: Number(e.target.value) })}
                />
                <label htmlFor={`field-rating-style-${index}`}>style</label>
                <Select
                  value={field.ratingStyle}
                  onValueChange={(v) => updateField(index, { ratingStyle: v as 'pills' | 'stars' })}
                >
                  <SelectTrigger id={`field-rating-style-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pills">numbered pills</SelectItem>
                    <SelectItem value="stars">stars</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {field.type === 'slider' && (
              <>
                <label htmlFor={`field-slider-min-${index}`}>minimum</label>
                <Input
                  id={`field-slider-min-${index}`}
                  type="number"
                  value={field.sliderMin}
                  onChange={(e) => updateField(index, { sliderMin: Number(e.target.value) })}
                />
                <label htmlFor={`field-slider-max-${index}`}>maximum</label>
                <Input
                  id={`field-slider-max-${index}`}
                  type="number"
                  value={field.sliderMax}
                  onChange={(e) => updateField(index, { sliderMax: Number(e.target.value) })}
                />
                <label htmlFor={`field-slider-step-${index}`}>step</label>
                <Input
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
                <Input
                  id={`field-low-${index}`}
                  value={field.lowLabel}
                  onChange={(e) => updateField(index, { lowLabel: e.target.value })}
                  placeholder="not likely"
                />
                <label htmlFor={`field-high-${index}`}>high-end label (optional)</label>
                <Input
                  id={`field-high-${index}`}
                  value={field.highLabel}
                  onChange={(e) => updateField(index, { highLabel: e.target.value })}
                  placeholder="extremely likely"
                />
              </>
            )}

            {canLinkKpis && canLinkKpiField && kpiOpen && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>link to KPI (optional)</span>
                {!kpiProducesLiveScore && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    this question type has no numeric answer, so linking it won't produce an automatic score —
                    use rating, NPS, slider, number, yes/no, choice, checkboxes, or likert questions for that.
                  </p>
                )}
                <label htmlFor={`field-kpi-${index}`}>KPI</label>
                <KpiLinkCombobox
                  kpis={kpis}
                  kpiId={field.kpiId}
                  evaluationAreaId={field.evaluationAreaId}
                  onSelect={(kpiId, evaluationAreaId) => void onLinkFieldToKpi(index, kpiId, evaluationAreaId)}
                  onClear={() => void onUnlinkFieldFromKpi(index)}
                />
                {kpiLinkErrors[index] && (
                  <p role="alert" className="form-error" style={{ fontSize: 12, marginTop: 4 }}>
                    {kpiLinkErrors[index]}
                  </p>
                )}
              </div>
            )}

            {(field.type === 'short_text' || field.type === 'long_text') && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>response validation (optional)</span>
                <label htmlFor={`field-minlen-${index}`}>minimum length</label>
                <Input
                  id={`field-minlen-${index}`}
                  type="number"
                  min={0}
                  value={field.minLength || ''}
                  onChange={(e) => updateField(index, { minLength: e.target.value === '' ? 0 : Number(e.target.value) })}
                  placeholder="no minimum"
                />
                <label htmlFor={`field-pattern-${index}`}>must match pattern (regex, optional)</label>
                <Input
                  id={`field-pattern-${index}`}
                  value={field.pattern}
                  onChange={(e) => updateField(index, { pattern: e.target.value })}
                  placeholder="e.g. ^[A-Z]{2}\\d{4}$"
                />
                {field.pattern && (
                  <>
                    <label htmlFor={`field-pattern-msg-${index}`}>error message when it doesn't match</label>
                    <Input
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
                  <Checkbox
                    id={`field-req-name-${index}`}
                    checked={field.requireName}
                    onCheckedChange={(checked) => updateField(index, { requireName: checked === true })}
                  />
                  <label htmlFor={`field-req-name-${index}`}>require name</label>
                </span>
                <span className="builder-required">
                  <Checkbox
                    id={`field-req-email-${index}`}
                    checked={field.requireEmail}
                    onCheckedChange={(checked) => updateField(index, { requireEmail: checked === true })}
                  />
                  <label htmlFor={`field-req-email-${index}`}>require email</label>
                </span>
                <span className="builder-required">
                  <Checkbox
                    id={`field-req-phone-${index}`}
                    checked={field.requirePhone}
                    onCheckedChange={(checked) => updateField(index, { requirePhone: checked === true })}
                  />
                  <label htmlFor={`field-req-phone-${index}`}>require phone</label>
                </span>
              </>
            )}

            {field.type === 'hot_spot' && (
              <div className="admin-card" style={{ padding: 8, marginTop: 4 }}>
                <label htmlFor={`field-hotspot-image-${index}`}>image</label>
                <Input
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
                    <Input
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
                      <Input
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
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        updateField(index, { hotSpotRegions: field.hotSpotRegions.filter((_, i) => i !== ri) })
                      }
                    >
                      remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
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
                </Button>
              </div>
            )}

            <div className="builder-field-actions">
              <div className="field-actions-primary">
                <Button type="button" variant="ghost" size="icon-sm" title="duplicate" aria-label="duplicate question" onClick={() => duplicateField(index)}>
                  ⧉
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="remove field"
                  aria-label="remove field"
                  onClick={() => removeField(index)}
                >
                  🗑
                </Button>
              </div>

              {field.type !== 'section_header' && (
                <span className="builder-required field-required-toggle">
                  <label htmlFor={`field-required-${index}`}>required</label>
                  <Switch
                    id={`field-required-${index}`}
                    checked={field.required}
                    onCheckedChange={(checked) => updateField(index, { required: checked })}
                  />
                </span>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="field-kebab-summary" aria-label="more actions" title="more actions">
                    ⋮
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => {
                      moveField(index, -1);
                    }}
                  >
                    ↑ move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === fields.length - 1}
                    onSelect={() => {
                      moveField(index, 1);
                    }}
                  >
                    ↓ move down
                  </DropdownMenuItem>
                  {canLinkKpis && canLinkKpiField && (
                    <DropdownMenuCheckboxItem
                      checked={kpiOpen}
                      onCheckedChange={(checked) => toggleKpiPanel(index, checked === true)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      link to KPI
                    </DropdownMenuCheckboxItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            </div>
            </div>
          </>
          )}
          </SortableCard>
          );
        })}
        </SortableContext>
        </DndContext>

        <Button
          type="button"
          variant="ghost"
          className="msform-add-field"
          onClick={() => addField()}
        >
          + add field
        </Button>
        </div>
        </div>

        <div className="page-title-row">
          <Button
            type="button"
            onClick={onPublish}
            disabled={!title.trim() || fields.length === 0 || fields.some((f) => !f.label.trim())}
          >
            {editingForm ? 'save changes' : 'publish'}
          </Button>
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

export default function NewOrEditFormPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <Suspense fallback={null}>
      <NewFormPage />
    </Suspense>
  );
}
