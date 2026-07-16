'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { AuthenticatedUser, FormDefinition } from '@pulse/contracts';
import { can } from '../../../components/portal-shell';
import type { UserPickerOption } from '../../../components/user-picker-combobox';
import { api, uploadAsset } from '../../../lib/api-client';
import type { DraftField, DraftSection, KpiOption } from './types';
import {
  emptyField,
  emptySection,
  fromDefinitionField,
  fromDefinitionSection,
  parseList,
  toDefinitionField,
  toKey,
} from './field-transforms';

/**
 * All form-builder state and mutation logic, extracted out of the page
 * component so the JSX stays focused on layout/composition. `editSlug` comes
 * from the page's own useSearchParams() call (which needs the Suspense
 * boundary set up one level up, in NewOrEditFormPage).
 */
export function useFormBuilder(user: AuthenticatedUser | null, editSlug: string | null) {
  const router = useRouter();
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
  const [sectionsEnabled, setSectionsEnabled] = useState(false);
  const [sections, setSections] = useState<DraftSection[]>([]);
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
  // Explicit ⋮-menu overrides for "go to section based on answer" — see branchingOpen below.
  const [branchingPanelOverrides, setBranchingPanelOverrides] = useState<Map<number, boolean>>(new Map());

  useEffect(() => {
    api<KpiOption[]>('/v1/kpis?pageSize=100')
      .then(setKpis)
      .catch(() => setKpis([]));
  }, []);

  useEffect(() => {
    if (!editSlug) return;
    let cancelled = false;
    setLoadingExisting(true);
    api<{ form: { id: string; slug: string }; definition: FormDefinition }>(`/v1/forms/${encodeURIComponent(editSlug)}`)
      .then(async ({ form, definition }) => {
        if (cancelled) return;
        setEditingForm({ id: form.id, slug: form.slug });
        setTitle(definition.title);
        setDescription(definition.description ?? '');
        setFields(definition.fields.map(fromDefinitionField));
        if (definition.sections && definition.sections.length > 0) {
          setSectionsEnabled(true);
          setSections(definition.sections.map(fromDefinitionSection));
        }
        // hydrate any existing per-question KPI links — best-effort, a
        // failure here just means the inline pickers start unlinked instead
        // of blocking the whole form load
        try {
          const mappings = await api<
            Array<{
              id: string;
              evaluationAreaId: string;
              subCriteriaId: string | null;
              scoreFieldKey: string;
              evaluationArea: { kpiId: string };
            }>
          >(`/v1/forms/${form.id}/kpi-mappings`);
          if (cancelled) return;
          setFields((current) =>
            current.map((f, i) => {
              const key = f.key ?? toKey(f.label, i);
              const match = mappings.find((m) => m.scoreFieldKey === key);
              return match
                ? {
                    ...f,
                    kpiId: match.evaluationArea.kpiId,
                    evaluationAreaId: match.evaluationAreaId,
                    subCriteriaId: match.subCriteriaId ?? '',
                    kpiMappingId: match.id,
                  }
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
  const canLinkKpis = can(user, 'forms:edit') && can(user, 'kpis:edit');

  // Derives each page's actual field list from where it starts and where the NEXT page starts,
  // in the form's own question order — a page is nothing but "everything between two breaks", so
  // reordering/adding/removing questions keeps every page correct with zero manual bookkeeping.
  // Sections also get re-sorted here by their resolved position: dragging a later page's first
  // question above an earlier page's questions moves the break itself, exactly like Google Forms.
  const resolvedSections = useMemo(() => {
    if (!sectionsEnabled || sections.length === 0) return [];
    const keys = keyedFields.map((f) => f.key);
    const withStart = sections
      .map((s, i) => ({ section: s, startIdx: i === 0 ? 0 : keys.indexOf(s.startFieldKey ?? '') }))
      // a page whose start question was deleted merges into whichever page precedes it —
      // removeField already drops these eagerly, this is just a defensive fallback
      .filter((x) => x.startIdx !== -1)
      .sort((a, b) => a.startIdx - b.startIdx);
    return withStart.map(({ section }, i) => ({
      ...section,
      fieldKeys: keys.slice(i === 0 ? 0 : withStart[i]!.startIdx, withStart[i + 1]?.startIdx ?? keys.length),
    }));
  }, [sections, keyedFields, sectionsEnabled]);

  const sectionIdSeq = useRef(1);
  function freshSectionId() {
    let id: string;
    do {
      id = `page_${sectionIdSeq.current++}`;
    } while (sections.some((s) => s.id === id));
    return id;
  }

  /** Inserts a page break right before this question — it, and every question after it up to the
   *  next break, becomes the new page. Position-based, so no other bookkeeping is needed. */
  function splitPageHere(fieldIndex: number) {
    const fieldKey = keyedFields[fieldIndex]?.key;
    if (!fieldKey) return;
    setSections((current) => [...current, emptySection(freshSectionId(), fieldKey)]);
  }

  function updateSection(id: string, patch: Partial<DraftSection>) {
    setSections((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  /** The "split into pages, with branching" checkbox: turning it on seeds a
   *  single first page if none exist yet, so there's always at least one
   *  page to attach fields to once branching is enabled. */
  function toggleSectionsEnabled(checked: boolean) {
    setSectionsEnabled(checked);
    if (checked && sections.length === 0) setSections([emptySection(freshSectionId(), null)]);
  }

  /** A page id can be a jump target from two places — a field's per-option `optionGoTo`, and
   *  another page's own `defaultGoTo`. Both need clearing whenever that page stops existing, or
   *  publish fails validation with a dangling "go to section" target. */
  function clearGoToTarget(id: string) {
    setFields((current) =>
      current.map((f) => {
        if (!Object.values(f.optionGoTo).includes(id)) return f;
        return {
          ...f,
          optionGoTo: Object.fromEntries(Object.entries(f.optionGoTo).map(([k, v]) => [k, v === id ? '' : v])),
        };
      }),
    );
    setSections((current) => current.map((s) => (s.defaultGoTo === id ? { ...s, defaultGoTo: '' } : s)));
  }

  /** Removes this page break — its questions merge into whichever page precedes it. The very
   *  first page has no break to remove (disabled in the UI); guarded here too, defensively. */
  function removeSection(id: string) {
    setSections((current) => (current.length <= 1 ? current : current.filter((s) => s.id !== id)));
    clearGoToTarget(id);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function markAllRequired() {
    // a section_header has no answer and can never be required
    setFields((current) => current.map((f) => (f.type === 'section_header' ? f : { ...f, required: true })));
  }

  function markAllOptional() {
    setFields((current) => current.map((f) => ({ ...f, required: false })));
  }

  /** Bulk version of "select a user" for multi_select: populates the options
   *  list with every active user in one click instead of adding them one at
   *  a time. Fetches first, applies via the functional setState form so it
   *  reads whatever the field's options are at apply time (not a stale
   *  closure) if it edited while the fetch was in flight. Skips anyone
   *  already present (by display name, same identity key "select a user"
   *  already uses) so re-running it after hand-picking a few doesn't
   *  duplicate them. */
  async function addAllUsersAsOptions(index: number) {
    const users = await api<UserPickerOption[]>('/v1/users?pageSize=200');
    setFields((current) =>
      current.map((f, i) => {
        if (i !== index) return f;
        const list = parseList(f.options);
        const seen = new Set(list);
        const optionUserIds = { ...f.optionUserIds };
        for (const u of users) {
          if (seen.has(u.displayName)) continue;
          list.push(u.displayName);
          seen.add(u.displayName);
          optionUserIds[u.displayName] = u.id;
        }
        return { ...f, options: list.join(', '), optionUserIds };
      }),
    );
  }

  function toggleKpiPanel(index: number, open: boolean) {
    setKpiPanelOverrides((current) => new Map(current).set(index, open));
  }

  function toggleBranchingPanel(index: number, open: boolean) {
    setBranchingPanelOverrides((current) => new Map(current).set(index, open));
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

  async function onLinkFieldToKpi(index: number, kpiId: string, evaluationAreaId: string, subCriteriaId?: string) {
    const field = fields[index];
    const scoreFieldKey = keyedFields[index]?.key;
    if (!field || !scoreFieldKey) return;
    setKpiLinkError(index, null);

    if (!editingForm) {
      updateField(index, { kpiId, evaluationAreaId, subCriteriaId: subCriteriaId ?? '' });
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
      // submitter scores themselves; see FormKpiScoringService.applyOneMapping).
      const mapping = await api<{ id: string }>(`/v1/forms/${editingForm.id}/kpi-mappings`, {
        method: 'POST',
        body: JSON.stringify({ evaluationAreaId, subCriteriaId, scoreFieldKey }),
      });
      updateField(index, { kpiId, evaluationAreaId, subCriteriaId: subCriteriaId ?? '', kpiMappingId: mapping.id });
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
    updateField(index, { kpiId: '', evaluationAreaId: '', subCriteriaId: '', kpiMappingId: '' });
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
        subCriteriaId: '',
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
    // if this question started a page, that page break goes with it — its remaining
    // questions merge into whichever page precedes it (handled by resolvedSections)
    const removedKey = keyedFields[index]?.key;
    if (removedKey) {
      const droppedSectionIds = sections.filter((s) => s.startFieldKey === removedKey).map((s) => s.id);
      setSections((current) => current.filter((s) => s.startFieldKey !== removedKey));
      droppedSectionIds.forEach(clearGoToTarget);
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

  // Options are stored as a single comma-joined string on the field; optionGoTo/
  // optionUserIds are keyed by option TEXT, not position, so reordering the parsed
  // list and rejoining is enough — those maps stay correct without touching them.
  function reorderOptionByDrag(fieldIndex: number, from: number, to: number) {
    setFields((current) =>
      current.map((f, i) => {
        if (i !== fieldIndex) return f;
        const list = parseList(f.options);
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved!);
        return { ...f, options: list.join(', ') };
      }),
    );
  }

  function onOptionDragEnd(fieldIndex: number, { active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    reorderOptionByDrag(fieldIndex, Number(active.id), Number(over.id));
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
      const {
        fields: parsed,
        issues,
        title: parsedTitle,
        description: parsedDescription,
      } = await parseFormWorkbook(file);
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
          optionUserIds: {},
          optionGoTo: {},
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
          subCriteriaId: '',
          kpiMappingId: '',
        })),
      ]);
      setImportIssues(issues);

      if (parsed.some((p) => p.page)) {
        const importedKeys = parsed.map((p, i) => toKey(p.label, baseIndex + i));
        // the parser only ever groups ADJACENT rows under the same page name, so each
        // group's first key is all a position-based page needs to anchor it
        const pageOrder: string[] = [];
        const firstKeyByPage = new Map<string, string>();
        parsed.forEach((p, i) => {
          if (!p.page || firstKeyByPage.has(p.page)) return;
          pageOrder.push(p.page);
          firstKeyByPage.set(p.page, importedKeys[i]!);
        });

        setSectionsEnabled(true);
        setSections((current) => [
          // anything already in the form before this import needs its own page too
          ...(current.length === 0 ? [emptySection(freshSectionId(), null)] : current),
          ...pageOrder.map((pageName) => ({
            ...emptySection(freshSectionId(), firstKeyByPage.get(pageName)!),
            title: pageName,
          })),
        ]);
      }
    } catch {
      setError('could not read this file — is it a valid .xlsx, .csv, or .docx file?');
    } finally {
      setImporting(false);
    }
  }

  async function onUploadSectionMedia(id: string, file: File) {
    try {
      const uploaded = await uploadAsset<{ id: string }>(file);
      updateSection(id, { mediaType: 'image', mediaAssetId: uploaded.id });
    } catch {
      setError('image upload failed');
    }
  }

  function buildSectionsPayload() {
    if (!sectionsEnabled || resolvedSections.length === 0) return undefined;
    return resolvedSections.map((s) => ({
      id: s.id,
      ...(s.title.trim() ? { title: s.title.trim() } : {}),
      ...(s.description.trim() ? { description: s.description.trim() } : {}),
      ...(s.mediaType === 'image' && s.mediaAssetId
        ? { media: { type: 'image' as const, assetId: s.mediaAssetId, ...(s.mediaAlt ? { alt: s.mediaAlt } : {}) } }
        : s.mediaType === 'video' && s.mediaUrl
          ? { media: { type: 'video' as const, url: s.mediaUrl, ...(s.mediaAlt ? { alt: s.mediaAlt } : {}) } }
          : {}),
      fieldKeys: s.fieldKeys,
      ...(s.defaultGoTo ? { defaultGoTo: s.defaultGoTo } : {}),
    }));
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
          body: JSON.stringify({
            evaluationAreaId: field.evaluationAreaId,
            subCriteriaId: field.subCriteriaId || undefined,
            scoreFieldKey,
          }),
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
      ...(buildSectionsPayload() ? { sections: buildSectionsPayload() } : {}),
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

  return {
    title,
    setTitle,
    description,
    setDescription,
    fields,
    activeFieldIndex,
    setActiveFieldIndex,
    fieldRefs,
    dragSensors,
    error,
    published,
    sectionsEnabled,
    toggleSectionsEnabled,
    sections,
    importing,
    importIssues,
    fileInputRef,
    editingForm,
    loadingExisting,
    kpis,
    kpiLinkErrors,
    kpiPanelOverrides,
    branchingPanelOverrides,
    keyedFields,
    canLinkKpis,
    resolvedSections,
    freshSectionId,
    splitPageHere,
    updateSection,
    removeSection,
    updateField,
    markAllRequired,
    markAllOptional,
    addAllUsersAsOptions,
    toggleKpiPanel,
    toggleBranchingPanel,
    onLinkFieldToKpi,
    onUnlinkFieldFromKpi,
    moveField,
    duplicateField,
    removeField,
    addField,
    onFieldDragEnd,
    onOptionDragEnd,
    onImportExcel,
    onUploadSectionMedia,
    onPublish,
  };
}

export type FormBuilder = ReturnType<typeof useFormBuilder>;
