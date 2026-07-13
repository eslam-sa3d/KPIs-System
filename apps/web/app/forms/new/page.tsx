'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Copy,
  GripVertical,
  MoreVertical,
  SeparatorHorizontal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { END_OF_FORM, SCORE_FIELD_TYPES, type FormDefinition } from '@pulse/contracts';
import { PortalShell, can } from '../../../components/portal-shell';
import { KpiLinkCombobox } from '../../../components/kpi-link-combobox';
import { UserPickerCombobox } from '../../../components/user-picker-combobox';
import { LoadingState } from '../../../components/loading-state';
import { api, assetUrl, uploadAsset } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FIELD_TYPE_OPTIONS, FIELD_TYPE_ICON } from './constants';
import type { DraftField, DraftSection, KpiOption } from './types';
import {
  parseList,
  emptyField,
  toKey,
  emptySection,
  toDefinitionField,
  fromDefinitionField,
  fromDefinitionSection,
} from './field-transforms';
import { SortableCard, SortableRow } from './sortable-card';

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
      // submitter scores themselves; see SubmissionsService.applyOneMapping).
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
        <h1 className="published-heading">
          <CheckCircle2 size={26} aria-hidden="true" className="published-heading-icon" />
          published
        </h1>
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
          <label htmlFor="form-description" className="msform-desc-label">
            description (optional)
          </label>
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
            <Button type="button" variant="ghost" disabled={importing} onClick={() => fileInputRef.current?.click()}>
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
                onClick={() =>
                  setFields((current) =>
                    // a section_header has no answer and can never be required
                    current.map((f) => (f.type === 'section_header' ? f : { ...f, required: true })),
                  )
                }
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
                    const fieldKey = keyedFields[index]?.key ?? '';
                    // "go to section based on answer" only makes sense once there's a LATER page to jump to.
                    const ownSectionIndex = sectionsEnabled
                      ? resolvedSections.findIndex((s) => s.fieldKeys.includes(fieldKey))
                      : -1;
                    const ownSection = ownSectionIndex >= 0 ? resolvedSections[ownSectionIndex] : undefined;
                    const laterSectionsForField = ownSection ? resolvedSections.slice(ownSectionIndex + 1) : [];
                    // this question is literally where its page begins/ends — drives the inline page
                    // header/footer rendered around its card, and whether "split a new page here" is offered
                    const isPageStart = ownSection?.fieldKeys[0] === fieldKey;
                    const isPageEnd = ownSection
                      ? ownSection.fieldKeys[ownSection.fieldKeys.length - 1] === fieldKey
                      : false;
                    const pageDisplayIndex = ownSection ? resolvedSections.indexOf(ownSection) : -1;
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
                    const kpiOpen = kpiPanelOverrides.has(index) ? kpiPanelOverrides.get(index)! : Boolean(field.kpiId);
                    // "go to section based on answer" panel visibility — same explicit-toggle-with-
                    // default-open-if-already-set pattern as kpiOpen above.
                    const branchingOpen = branchingPanelOverrides.has(index)
                      ? branchingPanelOverrides.get(index)!
                      : Object.values(field.optionGoTo).some((v) => v);
                    return (
                      <Fragment key={index}>
                        {isPageStart && ownSection && (
                          <div className="admin-card page-break-card" style={{ marginBottom: 12 }}>
                            <div className="page-title-row" style={{ marginBottom: 8 }}>
                              <span className="field-legend">
                                page {pageDisplayIndex + 1} of {resolvedSections.length}
                              </span>
                              {pageDisplayIndex > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  title="remove this page break"
                                  aria-label={`remove page ${pageDisplayIndex + 1} — merges its questions into the previous page`}
                                  onClick={() => removeSection(ownSection.id)}
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </Button>
                              )}
                            </div>

                            <label htmlFor={`section-title-${ownSection.id}`}>page title (optional)</label>
                            <Input
                              id={`section-title-${ownSection.id}`}
                              value={ownSection.title}
                              onChange={(e) => updateSection(ownSection.id, { title: e.target.value })}
                              placeholder={ownSection.id}
                            />

                            <label htmlFor={`section-description-${ownSection.id}`}>page description (optional)</label>
                            <Input
                              id={`section-description-${ownSection.id}`}
                              value={ownSection.description}
                              onChange={(e) => updateSection(ownSection.id, { description: e.target.value })}
                              placeholder="shown under the page title"
                            />

                            <label htmlFor={`section-media-type-${ownSection.id}`}>page media (optional)</label>
                            <Select
                              value={ownSection.mediaType}
                              onValueChange={(v) =>
                                updateSection(ownSection.id, { mediaType: v as DraftSection['mediaType'] })
                              }
                            >
                              <SelectTrigger id={`section-media-type-${ownSection.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">none</SelectItem>
                                <SelectItem value="image">image</SelectItem>
                                <SelectItem value="video">video (embed URL)</SelectItem>
                              </SelectContent>
                            </Select>
                            {ownSection.mediaType === 'image' && (
                              <>
                                <Input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) =>
                                    e.target.files?.[0] && onUploadSectionMedia(ownSection.id, e.target.files[0])
                                  }
                                />
                                {ownSection.mediaAssetId && (
                                  <img src={assetUrl(ownSection.mediaAssetId)} alt="" className="option-image" />
                                )}
                              </>
                            )}
                            {ownSection.mediaType === 'video' && (
                              <Input
                                value={ownSection.mediaUrl}
                                onChange={(e) => updateSection(ownSection.id, { mediaUrl: e.target.value })}
                                placeholder="https://www.youtube.com/embed/…"
                              />
                            )}
                          </div>
                        )}
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
                                    <ChevronDown size={16} aria-hidden="true" />
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
                                  {(field.type === 'select' ||
                                    field.type === 'multi_select' ||
                                    field.type === 'ranking') && (
                                    <>
                                      <label>options</label>
                                      <div className="option-rows">
                                        <DndContext
                                          sensors={dragSensors}
                                          collisionDetection={closestCenter}
                                          onDragEnd={(event) => onOptionDragEnd(index, event)}
                                        >
                                          <SortableContext
                                            items={parseList(field.options).map((_, i) => i)}
                                            strategy={verticalListSortingStrategy}
                                          >
                                            {parseList(field.options).map((optionValue, optionIndex) => (
                                              <SortableRow key={optionIndex} id={optionIndex} className="option-row">
                                                {(optionDrag) => (
                                                  <>
                                                    <button
                                                      type="button"
                                                      className="option-row-drag-handle"
                                                      title="drag to reorder"
                                                      aria-label={`drag to reorder option ${optionIndex + 1}`}
                                                      {...optionDrag.attributes}
                                                      {...optionDrag.listeners}
                                                    >
                                                      <GripVertical size={14} aria-hidden="true" />
                                                    </button>
                                                    <span
                                                      className={`option-row-mark${
                                                        field.type === 'multi_select'
                                                          ? ' is-checkbox'
                                                          : field.type === 'ranking'
                                                            ? ' is-rank'
                                                            : ''
                                                      }`}
                                                    >
                                                      {field.type === 'ranking' ? optionIndex + 1 : ''}
                                                    </span>
                                                    <Input
                                                      value={optionValue}
                                                      onChange={(e) => {
                                                        const list = parseList(field.options);
                                                        const previous = list[optionIndex]!;
                                                        list[optionIndex] = e.target.value;
                                                        const renamed = previous !== e.target.value;
                                                        updateField(index, {
                                                          options: list.join(', '),
                                                          // keep this option's "go to" mapping and user link keyed to its (possibly renamed) text
                                                          ...(renamed && previous in field.optionGoTo
                                                            ? {
                                                                optionGoTo: Object.fromEntries(
                                                                  Object.entries(field.optionGoTo).map(([k, v]) =>
                                                                    k === previous ? [e.target.value, v] : [k, v],
                                                                  ),
                                                                ),
                                                              }
                                                            : {}),
                                                          ...(renamed && previous in field.optionUserIds
                                                            ? {
                                                                optionUserIds: Object.fromEntries(
                                                                  Object.entries(field.optionUserIds).map(([k, v]) =>
                                                                    k === previous ? [e.target.value, v] : [k, v],
                                                                  ),
                                                                ),
                                                              }
                                                            : {}),
                                                        });
                                                      }}
                                                      placeholder={`Option ${optionIndex + 1}`}
                                                    />
                                                    {field.optionUserIds[optionValue] && (
                                                      <span
                                                        className="option-row-user-mark"
                                                        title="linked to a user — the answer will be that person's id"
                                                      >
                                                        <UserIcon size={14} aria-hidden="true" />
                                                      </span>
                                                    )}
                                                    {field.type === 'select' &&
                                                      laterSectionsForField.length > 0 &&
                                                      branchingOpen && (
                                                        <Select
                                                          value={field.optionGoTo[optionValue] || '__none__'}
                                                          onValueChange={(v) =>
                                                            updateField(index, {
                                                              optionGoTo: {
                                                                ...field.optionGoTo,
                                                                [optionValue]: v === '__none__' ? '' : v,
                                                              },
                                                            })
                                                          }
                                                        >
                                                          <SelectTrigger
                                                            className="option-row-goto"
                                                            aria-label={`go to section after "${optionValue}"`}
                                                          >
                                                            <SelectValue />
                                                          </SelectTrigger>
                                                          <SelectContent>
                                                            <SelectItem value="__none__">
                                                              continue to next section
                                                            </SelectItem>
                                                            {laterSectionsForField.map((t) => (
                                                              <SelectItem key={t.id} value={t.id}>
                                                                go to {t.title.trim() || t.id}
                                                              </SelectItem>
                                                            ))}
                                                            <SelectItem value={END_OF_FORM}>submit form</SelectItem>
                                                          </SelectContent>
                                                        </Select>
                                                      )}
                                                    <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="icon-xs"
                                                      className="option-row-remove"
                                                      title="remove option"
                                                      aria-label={`remove option ${optionIndex + 1}`}
                                                      onClick={() => {
                                                        const list = parseList(field.options).filter(
                                                          (_, i) => i !== optionIndex,
                                                        );
                                                        const { [optionValue]: _removed, ...optionGoTo } =
                                                          field.optionGoTo;
                                                        const { [optionValue]: _removedUser, ...optionUserIds } =
                                                          field.optionUserIds;
                                                        updateField(index, {
                                                          options: list.join(', '),
                                                          optionGoTo,
                                                          optionUserIds,
                                                        });
                                                      }}
                                                    >
                                                      <X size={12} aria-hidden="true" />
                                                    </Button>
                                                  </>
                                                )}
                                              </SortableRow>
                                            ))}
                                          </SortableContext>
                                        </DndContext>
                                        {(field.type === 'select' || field.type === 'multi_select') &&
                                          field.allowOther && (
                                            <div className="option-row option-row-other">
                                              <span
                                                className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`}
                                              />
                                              <span className="option-row-other-label">Other…</span>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                className="option-row-remove"
                                                title='remove "other"'
                                                aria-label="remove other"
                                                onClick={() => updateField(index, { allowOther: false })}
                                              >
                                                <X size={12} aria-hidden="true" />
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
                                            <span
                                              className={`option-row-mark${field.type === 'multi_select' ? ' is-checkbox' : ''}`}
                                            />
                                            add option
                                          </Button>
                                          {(field.type === 'select' || field.type === 'multi_select') &&
                                            !field.allowOther && (
                                              <>
                                                {' '}
                                                or{' '}
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
                                          {field.type === 'select' && (
                                            <>
                                              {' '}
                                              or{' '}
                                              <UserPickerCombobox
                                                triggerLabel="select a user"
                                                onSelect={(u) => {
                                                  const list = parseList(field.options);
                                                  list.push(u.displayName);
                                                  updateField(index, {
                                                    options: list.join(', '),
                                                    optionUserIds: { ...field.optionUserIds, [u.displayName]: u.id },
                                                  });
                                                }}
                                              />
                                            </>
                                          )}
                                        </div>
                                      </div>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-shuffle-${index}`}
                                          checked={field.shuffleOptions}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { shuffleOptions: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-shuffle-${index}`}>
                                          {field.type === 'ranking'
                                            ? 'randomize starting order'
                                            : 'shuffle option order per respondent'}
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
                                        onValueChange={(v) =>
                                          updateField(index, { gridSelection: v as 'single' | 'multiple' })
                                        }
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
                                          onCheckedChange={(checked) =>
                                            updateField(index, { gridRequireOnePerRow: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-grid-require-row-${index}`}>
                                          require a response in each row
                                        </label>
                                      </span>
                                    </>
                                  )}

                                  {field.type === 'file' && (
                                    <>
                                      <label htmlFor={`field-mime-${index}`}>
                                        accepted file types (comma-separated MIME types)
                                      </label>
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
                                        onValueChange={(v) =>
                                          updateField(index, { ratingStyle: v as 'pills' | 'stars' })
                                        }
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
                                    <div className="field-subpanel">
                                      <span className="muted" style={{ fontSize: 12 }}>
                                        link to KPI (optional)
                                      </span>
                                      {!kpiProducesLiveScore && (
                                        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                                          this question type has no numeric answer, so linking it won't produce an
                                          automatic score — use rating, NPS, slider, number, yes/no, choice, checkboxes,
                                          or likert questions for that.
                                        </p>
                                      )}
                                      <label htmlFor={`field-kpi-${index}`}>KPI</label>
                                      <KpiLinkCombobox
                                        kpis={kpis}
                                        kpiId={field.kpiId}
                                        evaluationAreaId={field.evaluationAreaId}
                                        subCriteriaId={field.subCriteriaId}
                                        onSelect={(kpiId, evaluationAreaId, subCriteriaId) =>
                                          void onLinkFieldToKpi(index, kpiId, evaluationAreaId, subCriteriaId)
                                        }
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
                                    <div className="field-subpanel">
                                      <span className="muted" style={{ fontSize: 12 }}>
                                        response validation (optional)
                                      </span>
                                      <label htmlFor={`field-minlen-${index}`}>minimum length</label>
                                      <Input
                                        id={`field-minlen-${index}`}
                                        type="number"
                                        min={0}
                                        value={field.minLength || ''}
                                        onChange={(e) =>
                                          updateField(index, {
                                            minLength: e.target.value === '' ? 0 : Number(e.target.value),
                                          })
                                        }
                                        placeholder="no minimum"
                                      />
                                      <label htmlFor={`field-pattern-${index}`}>
                                        must match pattern (regex, optional)
                                      </label>
                                      <Input
                                        id={`field-pattern-${index}`}
                                        value={field.pattern}
                                        onChange={(e) => updateField(index, { pattern: e.target.value })}
                                        placeholder="e.g. ^[A-Z]{2}\\d{4}$"
                                      />
                                      {field.pattern && (
                                        <>
                                          <label htmlFor={`field-pattern-msg-${index}`}>
                                            error message when it doesn't match
                                          </label>
                                          <Input
                                            id={`field-pattern-msg-${index}`}
                                            value={field.patternErrorMessage}
                                            onChange={(e) =>
                                              updateField(index, { patternErrorMessage: e.target.value })
                                            }
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
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requireName: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-name-${index}`}>require name</label>
                                      </span>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-req-email-${index}`}
                                          checked={field.requireEmail}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requireEmail: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-email-${index}`}>require email</label>
                                      </span>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-req-phone-${index}`}
                                          checked={field.requirePhone}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requirePhone: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-phone-${index}`}>require phone</label>
                                      </span>
                                    </>
                                  )}

                                  {field.type === 'hot_spot' && (
                                    <div className="field-subpanel">
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
                                        <img
                                          src={assetUrl(field.hotSpotAssetId)}
                                          alt=""
                                          className="option-image"
                                          style={{ maxWidth: 240 }}
                                        />
                                      )}
                                      <span className="muted" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                                        regions (x/y/width/height as % of the image)
                                      </span>
                                      {field.hotSpotRegions.map((region, ri) => (
                                        <div
                                          key={ri}
                                          className="builder-required"
                                          style={{ marginTop: 4, flexWrap: 'wrap' }}
                                        >
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
                                              updateField(index, {
                                                hotSpotRegions: field.hotSpotRegions.filter((_, i) => i !== ri),
                                              })
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
                                              {
                                                value: `region_${field.hotSpotRegions.length + 1}`,
                                                label: `region ${field.hotSpotRegions.length + 1}`,
                                                x: 10,
                                                y: 10,
                                                width: 20,
                                                height: 20,
                                              },
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
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        title="duplicate"
                                        aria-label="duplicate question"
                                        onClick={() => duplicateField(index)}
                                      >
                                        <Copy size={14} aria-hidden="true" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        title="remove field"
                                        aria-label="remove field"
                                        onClick={() => removeField(index)}
                                      >
                                        <Trash2 size={14} aria-hidden="true" />
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
                                        <button
                                          type="button"
                                          className="field-kebab-summary"
                                          aria-label="more actions"
                                          title="more actions"
                                        >
                                          <MoreVertical size={16} aria-hidden="true" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent>
                                        <DropdownMenuItem
                                          disabled={index === 0}
                                          onSelect={() => {
                                            moveField(index, -1);
                                          }}
                                        >
                                          <ArrowUp size={14} aria-hidden="true" /> move up
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={index === fields.length - 1}
                                          onSelect={() => {
                                            moveField(index, 1);
                                          }}
                                        >
                                          <ArrowDown size={14} aria-hidden="true" /> move down
                                        </DropdownMenuItem>
                                        {sectionsEnabled && !isPageStart && (
                                          <DropdownMenuItem
                                            onSelect={() => {
                                              splitPageHere(index);
                                            }}
                                          >
                                            <SeparatorHorizontal size={14} aria-hidden="true" /> split into a new page
                                            here
                                          </DropdownMenuItem>
                                        )}
                                        {field.type === 'select' &&
                                          sectionsEnabled &&
                                          (laterSectionsForField.length > 0 ? (
                                            <DropdownMenuCheckboxItem
                                              checked={branchingOpen}
                                              onCheckedChange={(checked) => {
                                                toggleBranchingPanel(index, checked === true);
                                                // Unchecking is the actual off switch, not just a UI collapse — clear
                                                // every option's jump so a respondent's flow really does go back to
                                                // normal, rather than leaving stale jumps active behind a hidden panel.
                                                if (checked !== true) updateField(index, { optionGoTo: {} });
                                              }}
                                              onSelect={(e) => e.preventDefault()}
                                            >
                                              go to section based on answer
                                            </DropdownMenuCheckboxItem>
                                          ) : (
                                            <DropdownMenuItem disabled onSelect={(e) => e.preventDefault()}>
                                              no later page to route to
                                            </DropdownMenuItem>
                                          ))}
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
                        {isPageEnd && ownSection && laterSectionsForField.length > 0 && (
                          <div className="admin-card" style={{ marginTop: -8, marginBottom: 12 }}>
                            <label htmlFor={`section-default-${ownSection.id}`}>after this page, go to</label>
                            <Select
                              value={ownSection.defaultGoTo || '__none__'}
                              onValueChange={(v) =>
                                updateSection(ownSection.id, { defaultGoTo: v === '__none__' ? '' : v })
                              }
                            >
                              <SelectTrigger id={`section-default-${ownSection.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">continue to the next page</SelectItem>
                                {laterSectionsForField.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.title.trim() || t.id}
                                  </SelectItem>
                                ))}
                                <SelectItem value={END_OF_FORM}>submit form</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </SortableContext>
              </DndContext>

              <Button type="button" variant="ghost" className="msform-add-field" onClick={() => addField()}>
                + add field
              </Button>
            </div>
          </div>

          <div className="admin-card" style={{ marginTop: 24, marginBottom: 16 }}>
            <span className="builder-required">
              <Checkbox
                id="sections-toggle"
                checked={sectionsEnabled}
                onCheckedChange={(checked) => {
                  setSectionsEnabled(checked === true);
                  if (checked === true && sections.length === 0) setSections([emptySection(freshSectionId(), null)]);
                }}
              />
              <label htmlFor="sections-toggle">split into pages, with branching</label>
            </span>
            {sectionsEnabled && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                open a question's ⋮ menu and choose "split into a new page here" — everything from that question onward
                moves to the new page. a "choice (one answer)" question can also send each of its own options to a
                specific later page (or submit the form early).
              </p>
            )}
          </div>

          <div className="page-title-row">
            <Button
              type="button"
              onClick={onPublish}
              disabled={
                !title.trim() ||
                fields.length === 0 ||
                fields.some((f) => !f.label.trim()) ||
                (sectionsEnabled && resolvedSections.some((s) => s.fieldKeys.length === 0))
              }
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
