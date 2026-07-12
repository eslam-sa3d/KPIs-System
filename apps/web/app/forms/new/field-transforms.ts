import type { FieldType, FormField, FormSection } from '@pulse/contracts';
import type { ConditionOperator, DraftField, DraftSection, KeyedField } from './types';

export const parseList = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const emptyField = (): DraftField => ({
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
  optionUserIds: {},
  optionGoTo: {},
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
export const toKey = (label: string, index: number) => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/, '');
  return (/^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`).slice(0, 64);
};

export const emptySection = (id: string, startFieldKey: string | null): DraftSection => ({
  id,
  title: '',
  description: '',
  mediaType: 'none',
  mediaAssetId: '',
  mediaUrl: '',
  mediaAlt: '',
  startFieldKey,
  defaultGoTo: '',
});

/** Coerces the builder's always-string visibleWhen value to match its target field's answer shape
 *  (a boolean-target field stores real booleans; gt/lt need a real number to compare). */
export function coerceVisibleWhenValue(raw: string, operator: ConditionOperator, targetType: FieldType | undefined) {
  if (operator === 'gt' || operator === 'lt') return Number(raw);
  if (targetType === 'boolean') return raw === 'true';
  if (targetType === 'number' || targetType === 'rating' || targetType === 'nps') return Number(raw);
  return raw;
}

export function toDefinitionField(draft: DraftField, index: number, keyedFields: KeyedField[]) {
  const visibleWhenTarget = keyedFields.find((f) => f.key === draft.visibleWhenFieldKey);
  const base = {
    key: draft.key ?? toKey(draft.label, index),
    label: draft.label,
    // A section_header has no answer and can never be required — forced
    // false here regardless of draft state so a field that ended up required
    // some other way (an old "mark all required" bug, a legacy import) heals
    // itself on the next save instead of blocking publish.
    required: draft.type === 'section_header' ? false : draft.required,
    ...(draft.helpText.trim() ? { helpText: draft.helpText.trim() } : {}),
    ...(draft.mediaType === 'image' && draft.mediaAssetId
      ? {
          media: {
            type: 'image' as const,
            assetId: draft.mediaAssetId,
            ...(draft.mediaAlt ? { alt: draft.mediaAlt } : {}),
          },
        }
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
  // A user-linked option's real answer value is that User's id, not its
  // displayed text — resolveOptionValue keeps the raw typed/displayed text
  // (used everywhere else as the draft-side key: optionGoTo, optionImages,
  // list editing) while swapping in the id for the published option's value.
  const resolveOptionValue = (o: string) => draft.optionUserIds[o] ?? o;
  const withImages = (values: string[]) =>
    values.map((o) => ({
      value: resolveOptionValue(o),
      label: o,
      ...(draft.optionImages[o] ? { imageAssetId: draft.optionImages[o] } : {}),
      ...(draft.optionUserIds[o] ? { userId: draft.optionUserIds[o] } : {}),
    }));
  const quizPoints = draft.points > 0 ? { points: draft.points } : {};
  const quizFeedback = {
    ...(draft.feedbackCorrect.trim() ? { feedbackCorrect: draft.feedbackCorrect.trim() } : {}),
    ...(draft.feedbackIncorrect.trim() ? { feedbackIncorrect: draft.feedbackIncorrect.trim() } : {}),
  };
  switch (draft.type) {
    case 'select': {
      const optionValues = parseList(draft.options);
      const options = withImages(optionValues);
      const optionGoTo = Object.fromEntries(
        optionValues
          .map((v): [string, string] => [resolveOptionValue(v), draft.optionGoTo[v] ?? ''])
          .filter(([, goTo]) => goTo !== ''),
      );
      return {
        ...base,
        type: draft.type,
        options,
        layout: draft.layout,
        allowOther: draft.allowOther,
        shuffleOptions: draft.shuffleOptions,
        ...(Object.keys(optionGoTo).length > 0 ? { optionGoTo } : {}),
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
export function fromDefinitionField(field: FormField): DraftField {
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

  const optionsToDraft = (options: Array<{ value: string; label: string; imageAssetId?: string; userId?: string }>) => {
    // A user-linked option's displayed/edited text is its label (the user's
    // display name at the time it was added), not its value (that user's
    // id) — every other option still has value === label, so this is a
    // no-op for anything the builder itself produced before this feature.
    draft.options = options.map((o) => o.label).join(', ');
    draft.optionImages = Object.fromEntries(
      options.filter((o) => o.imageAssetId).map((o) => [o.label, o.imageAssetId!]),
    );
    draft.optionUserIds = Object.fromEntries(options.filter((o) => o.userId).map((o) => [o.label, o.userId!]));
  };

  switch (field.type) {
    case 'select': {
      optionsToDraft(field.options);
      draft.layout = field.layout;
      draft.allowOther = field.allowOther;
      draft.shuffleOptions = field.shuffleOptions;
      // field.optionGoTo is keyed by each option's real value (a user id for
      // a user-linked option) — the draft keys it by the option's displayed
      // text instead (see optionsToDraft above), so re-key through value ->
      // label on the way in.
      const labelByValue = new Map(field.options.map((o) => [o.value, o.label]));
      draft.optionGoTo = Object.fromEntries(
        Object.entries(field.optionGoTo ?? {}).map(([value, goTo]) => [labelByValue.get(value) ?? value, goTo]),
      );
      if (field.correctValue !== undefined) {
        draft.correctValue = field.correctValue;
        draft.points = field.points ?? 0;
        draft.feedbackCorrect = field.feedbackCorrect ?? '';
        draft.feedbackIncorrect = field.feedbackIncorrect ?? '';
      }
      break;
    }
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
    case 'performance_level':
      break;
  }
  return draft;
}

/** Reverses buildSectionsPayload: rebuilds a DraftSection from a saved
 *  FormSection. A section published under the previous (MS-Forms-style)
 *  `branching`/`branchRules` model reopens with no "after this page" default
 *  set here — same as any other legacy data the builder no longer edits;
 *  republishing preserves the original fields but writes the current model.
 *  `fieldKeys` collapses down to just its first entry (`startFieldKey`) — the
 *  builder only ever writes contiguous pages, so this is lossless for
 *  anything the current builder itself produced. */
export function fromDefinitionSection(section: FormSection, index: number): DraftSection {
  return {
    id: section.id,
    title: section.title ?? '',
    description: section.description ?? '',
    mediaType: section.media?.type === 'image' ? 'image' : section.media?.type === 'video' ? 'video' : 'none',
    mediaAssetId: section.media?.type === 'image' ? (section.media.assetId ?? '') : '',
    mediaUrl: section.media?.type === 'video' ? (section.media.url ?? '') : '',
    mediaAlt: section.media?.alt ?? '',
    startFieldKey: index === 0 ? null : (section.fieldKeys[0] ?? null),
    defaultGoTo: section.defaultGoTo ?? '',
  };
}
