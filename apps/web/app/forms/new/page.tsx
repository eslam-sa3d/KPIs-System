'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { END_OF_FORM, type FieldType } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
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
  scale: number;
  lowLabel: string;
  highLabel: string;
  /** comma-separated likert scale labels, e.g. "disagree,neutral,agree" */
  likertScale: string;
  /** comma-separated MIME types accepted for a file-upload field */
  acceptedMimeTypes: string;
  maxSizeMb: number;
}

const emptyField = (): DraftField => ({
  label: '',
  helpText: '',
  type: 'short_text',
  required: false,
  options: '',
  layout: 'dropdown',
  allowOther: false,
  scale: 5,
  lowLabel: '',
  highLabel: '',
  likertScale: 'disagree, neutral, agree',
  acceptedMimeTypes: 'application/pdf, image/png, image/jpeg',
  maxSizeMb: 10,
});

const toKey = (label: string, index: number) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`;
};

interface DraftSection {
  id: string;
  title: string;
  fieldKeys: string[];
  /** the choice/rating/likert field this page branches on, or '' for no per-answer branching */
  branchFieldKey: string;
  /** only used when branchFieldKey names a likert field: which statement drives the branch */
  branchStatement: string;
  /** option value (or stringified rating score / likert scale index) -> target page id / "end" */
  cases: Record<string, string>;
  /** unconditional/fallback target page id or "end"; '' = continue to the next page normally */
  defaultGoTo: string;
}

const emptySection = (index: number): DraftSection => ({
  id: `page_${index + 1}`,
  title: '',
  fieldKeys: [],
  branchFieldKey: '',
  branchStatement: '',
  cases: {},
  defaultGoTo: '',
});

function toDefinitionField(draft: DraftField, index: number) {
  const base = {
    key: toKey(draft.label, index),
    label: draft.label,
    required: draft.required,
    ...(draft.helpText.trim() ? { helpText: draft.helpText.trim() } : {}),
  };
  switch (draft.type) {
    case 'select': {
      const options = parseList(draft.options).map((o) => ({ value: o, label: o }));
      return { ...base, type: draft.type, options, layout: draft.layout, allowOther: draft.allowOther };
    }
    case 'multi_select': {
      const options = parseList(draft.options).map((o) => ({ value: o, label: o }));
      return { ...base, type: draft.type, options };
    }
    case 'ranking': {
      const options = parseList(draft.options).map((o) => ({ value: o, label: o }));
      return { ...base, type: draft.type, options };
    }
    case 'likert': {
      const statements = parseList(draft.options).map((o) => ({ value: o, label: o }));
      const scale = parseList(draft.likertScale);
      return { ...base, type: draft.type, statements, scale };
    }
    case 'file': {
      const acceptedMimeTypes = parseList(draft.acceptedMimeTypes);
      return { ...base, type: draft.type, acceptedMimeTypes, maxSizeMb: draft.maxSizeMb };
    }
    case 'rating':
      return {
        ...base,
        type: draft.type,
        scale: draft.scale,
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
      const { fields: parsed, issues } = await parseFormWorkbook(file);
      if (parsed.length === 0) {
        setError(issues[0] ?? 'no usable rows found — check that the sheet has a "question" column');
        return;
      }

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
          scale: p.scale,
          lowLabel: p.lowLabel,
          highLabel: p.highLabel,
          likertScale: p.likertScale,
          acceptedMimeTypes: p.acceptedMimeTypes,
          maxSizeMb: p.maxSizeMb,
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
      setError('could not read this file — is it a valid .xlsx spreadsheet?');
    } finally {
      setImporting(false);
    }
  }

  function buildSectionsPayload() {
    if (!sectionsEnabled || sections.length === 0) return undefined;
    return sections.map((s) => {
      const cases = Object.entries(s.cases)
        .filter(([, goTo]) => goTo)
        .map(([equals, goTo]) => ({ equals, goTo }));
      const hasBranching = cases.length > 0 || Boolean(s.defaultGoTo);
      return {
        id: s.id,
        ...(s.title.trim() ? { title: s.title.trim() } : {}),
        fieldKeys: s.fieldKeys,
        ...(hasBranching
          ? {
              branching: {
                ...(s.branchFieldKey ? { onFieldKey: s.branchFieldKey } : {}),
                ...(s.branchStatement ? { onStatement: s.branchStatement } : {}),
                cases,
                ...(s.defaultGoTo ? { defaultGoTo: s.defaultGoTo } : {}),
              },
            }
          : {}),
      };
    });
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
            fields: fields.map(toDefinitionField),
            ...(buildSectionsPayload() ? { sections: buildSectionsPayload() } : {}),
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
          <label>import questions from a spreadsheet</label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            columns: question (required), type, required, options, help text, page. unrecognized types
            default to short text.
          </p>
          <input
            ref={fileInputRef}
            id="excel-import-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={onImportExcel}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'reading file…' : 'import from Excel'}
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

            {(field.type === 'select' || field.type === 'multi_select' || field.type === 'ranking') && (
              <>
                <label htmlFor={`field-options-${index}`}>options (comma-separated)</label>
                <input
                  id={`field-options-${index}`}
                  value={field.options}
                  onChange={(e) => updateField(index, { options: e.target.value })}
                  placeholder="red, amber, green"
                />
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
              </>
            )}

            {(field.type === 'rating' || field.type === 'nps') && (
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

            <span className="builder-required">
              <input
                id={`field-required-${index}`}
                type="checkbox"
                checked={field.required}
                onChange={(e) => updateField(index, { required: e.target.checked })}
              />
              <label htmlFor={`field-required-${index}`}>required</label>
            </span>

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
                  (f) =>
                    (f.type === 'select' || f.type === 'multi_select' || f.type === 'rating' || f.type === 'likert') &&
                    section.fieldKeys.includes(f.key),
                );
                const trigger = triggerCandidates.find((f) => f.key === section.branchFieldKey);
                // for select: option values; for likert: its statement values (parsed into .options too)
                const caseKeys =
                  trigger?.type === 'rating'
                    ? Array.from({ length: trigger.scale }, (_, i) => String(i + 1))
                    : trigger?.type === 'likert'
                      ? trigger.likertScale.map((_, i) => String(i))
                      : (trigger?.options ?? []);
                const caseLabelOf = (key: string) =>
                  trigger?.type === 'likert' ? (trigger.likertScale[Number(key)] ?? key) : key;

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
                        <label htmlFor={`section-trigger-${index}`}>branch on (optional)</label>
                        <select
                          id={`section-trigger-${index}`}
                          value={section.branchFieldKey}
                          onChange={(e) =>
                            updateSection(index, { branchFieldKey: e.target.value, branchStatement: '', cases: {} })
                          }
                        >
                          <option value="">no per-answer branching</option>
                          {triggerCandidates.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} ({f.type})
                            </option>
                          ))}
                        </select>

                        {trigger?.type === 'likert' && (
                          <>
                            <label htmlFor={`section-statement-${index}`}>which statement drives the branch</label>
                            <select
                              id={`section-statement-${index}`}
                              value={section.branchStatement}
                              onChange={(e) => updateSection(index, { branchStatement: e.target.value, cases: {} })}
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

                        {trigger && (trigger.type !== 'likert' || section.branchStatement) &&
                          caseKeys.map((key) => (
                            <div key={key}>
                              <label htmlFor={`section-case-${index}-${key}`}>
                                if {trigger?.type === 'multi_select' ? 'selections include' : 'answer is'} "
                                {caseLabelOf(key)}" go to
                              </label>
                              <select
                                id={`section-case-${index}-${key}`}
                                value={section.cases[key] ?? ''}
                                onChange={(e) =>
                                  updateSection(index, { cases: { ...section.cases, [key]: e.target.value } })
                                }
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
                          ))}

                        <label htmlFor={`section-default-${index}`}>
                          {trigger ? 'if none of the above match' : 'always jump to (unconditional)'}
                        </label>
                        <select
                          id={`section-default-${index}`}
                          value={section.defaultGoTo}
                          onChange={(e) => updateSection(index, { defaultGoTo: e.target.value })}
                        >
                          <option value="">continue to the next page</option>
                          {laterSections.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title.trim() || t.id}
                            </option>
                          ))}
                          <option value={END_OF_FORM}>end the form</option>
                        </select>
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
