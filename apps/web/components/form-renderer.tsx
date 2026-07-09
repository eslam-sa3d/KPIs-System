'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PIPE_TAG_PATTERN, resolveSectionPath, type FormDefinition, type FormField, type FormSettings, type SubmissionAnswers } from '@pulse/contracts';
import { ApiRequestError, assetUrl, uploadFile } from '../lib/api-client';
import type { Media } from '@pulse/contracts';

function FieldMedia({ media }: { media: Media }) {
  if (media.type === 'image' && media.assetId) {
    return <img src={assetUrl(media.assetId)} alt={media.alt ?? ''} className="question-media-image" />;
  }
  if (media.type === 'video' && media.url) {
    return (
      <iframe
        src={media.url}
        title={media.alt ?? 'question video'}
        className="question-media-video"
        allowFullScreen
      />
    );
  }
  return null;
}

export const isVisible = (field: FormField, answers: SubmissionAnswers) => {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const actual = answers[rule.fieldKey];
  switch (rule.operator ?? 'equals') {
    case 'not_equals':
      return actual !== rule.equals;
    case 'gt':
      return typeof actual === 'number' && actual > Number(rule.equals);
    case 'lt':
      return typeof actual === 'number' && actual < Number(rule.equals);
    case 'contains':
      return Array.isArray(actual)
        ? actual.includes(String(rule.equals))
        : typeof actual === 'string' && actual.includes(String(rule.equals));
    default:
      return actual === rule.equals;
  }
};

/** Answer piping: replaces every {{field_key}} in a label/helpText with that
 *  field's current in-progress answer — blank until answered, never the raw tag. */
export function applyPiping(text: string, answers: SubmissionAnswers): string {
  return text.replace(PIPE_TAG_PATTERN, (_match, key: string) => {
    const value = answers[key];
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return ''; // compound answers (likert/contact_info) aren't piped
    return String(value);
  });
}

/** Exported for reuse by ResponseDetailModal's edit mode — same input for filling and correcting. */
export function FieldInput({
  field,
  value,
  onChange,
  uploadPath,
}: {
  field: FormField;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
  uploadPath: string;
}) {
  const id = `f-${field.key}`;
  const [uploadState, setUploadState] = useState<{ busy: boolean; filename: string | null; error: string | null }>({
    busy: false,
    filename: null,
    error: null,
  });
  // multi-file (maxFiles>1): filenames for ids uploaded THIS session — reloading an
  // in-progress answer only shows ids, so older attachments fall back to a generic label
  const [attachedNames, setAttachedNames] = useState<Record<string, string>>({});

  switch (field.type) {
    case 'long_text':
      return <textarea id={id} rows={4} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <input id={id} type="number" value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      );
    case 'date':
      return <input id={id} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'rating': {
      const current = value as number | undefined;
      if (field.style === 'stars') {
        return (
          <div className="scale-row star-row" role="radiogroup" aria-labelledby={`${id}-label`} id={id}>
            {field.lowLabel && <span className="muted scale-cap">{field.lowLabel}</span>}
            {Array.from({ length: field.scale }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={current === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className={`star-pill${current !== undefined && n <= current ? ' star-pill-active' : ''}`}
                onClick={() => onChange(n)}>
                ★
              </button>
            ))}
            {field.highLabel && <span className="muted scale-cap">{field.highLabel}</span>}
          </div>
        );
      }
      return (
        <div className="scale-row" role="radiogroup" aria-labelledby={`${id}-label`} id={id}>
          {field.lowLabel && <span className="muted scale-cap">{field.lowLabel}</span>}
          {Array.from({ length: field.scale }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={current === n}
              className={`scale-pill${current === n ? ' scale-pill-active' : ''}`}
              onClick={() => onChange(n)}>
              {n}
            </button>
          ))}
          {field.highLabel && <span className="muted scale-cap">{field.highLabel}</span>}
        </div>
      );
    }
    case 'nps': {
      const current = value as number | undefined;
      return (
        <div className="scale-row" role="radiogroup" id={id}>
          <span className="muted scale-cap">{field.lowLabel}</span>
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={current === n}
              className={`scale-pill${current === n ? ' scale-pill-active' : ''}`}
              onClick={() => onChange(n)}>
              {n}
            </button>
          ))}
          <span className="muted scale-cap">{field.highLabel}</span>
        </div>
      );
    }
    case 'select': {
      const raw = (value as string) ?? '';
      const isOther = raw.startsWith('other:');
      if (field.layout === 'radio') {
        return (
          <span className="check-group" id={id}>
            {field.options.map((o) => (
              <label key={o.value} className="check-item">
                <input type="radio" name={id} checked={raw === o.value} onChange={() => onChange(o.value)} />
                {o.imageAssetId && <img src={assetUrl(o.imageAssetId)} alt="" className="option-image" />}
                {o.label}
              </label>
            ))}
            {field.allowOther && (
              <label className="check-item">
                <input type="radio" name={id} checked={isOther} onChange={() => onChange('other:')} />
                other:
                {isOther && (
                  <input type="text" aria-label={`${field.label} other`} value={raw.slice(6)}
                    onChange={(e) => onChange(`other:${e.target.value}`)} />
                )}
              </label>
            )}
          </span>
        );
      }
      return (
        <>
          <select id={id} value={isOther ? '__other' : raw}
            onChange={(e) => onChange(e.target.value === '__other' ? 'other:' : e.target.value)}>
            <option value="">—</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {field.allowOther && <option value="__other">other…</option>}
          </select>
          {isOther && (
            <input type="text" aria-label={`${field.label} other`} placeholder="please specify"
              value={raw.slice(6)} onChange={(e) => onChange(`other:${e.target.value}`)} />
          )}
        </>
      );
    }
    case 'multi_select': {
      const selected = (value as string[] | undefined) ?? [];
      return (
        <span className="check-group" id={id}>
          {field.options.map((o) => (
            <label key={o.value} className="check-item">
              <input type="checkbox" checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
                } />
              {o.imageAssetId && <img src={assetUrl(o.imageAssetId)} alt="" className="option-image" />}
              {o.label}
            </label>
          ))}
        </span>
      );
    }
    case 'likert': {
      const current = (value as Record<string, number> | undefined) ?? {};
      return (
        <div className="likert" id={id} role="table">
          <div className="likert-row likert-head" role="row">
            <span role="columnheader" />
            {field.scale.map((s) => (
              <span key={s} role="columnheader" className="muted">{s}</span>
            ))}
          </div>
          {field.statements.map((st) => (
            <div key={st.value} className="likert-row" role="row">
              <span role="rowheader">{st.label}</span>
              {field.scale.map((s, idx) => (
                <span key={s} role="cell">
                  <input type="radio" name={`${id}-${st.value}`} aria-label={`${st.label}: ${s}`}
                    checked={current[st.value] === idx}
                    onChange={() => onChange({ ...current, [st.value]: idx })} />
                </span>
              ))}
            </div>
          ))}
        </div>
      );
    }
    case 'ranking': {
      const order = (value as string[] | undefined) ?? field.options.map((o) => o.value);
      const labelOf = (v: string) => field.options.find((o) => o.value === v)?.label ?? v;
      const imageOf = (v: string) => field.options.find((o) => o.value === v)?.imageAssetId;
      const move = (index: number, delta: number) => {
        const next = [...order];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target]!, next[index]!];
        onChange(next);
      };
      return (
        <ol className="ranking" id={id}>
          {order.map((v, i) => (
            <li key={v} className="ranking-item">
              <span>
                {i + 1}. {imageOf(v) && <img src={assetUrl(imageOf(v)!)} alt="" className="option-image" />}
                {labelOf(v)}
              </span>
              <span className="ranking-controls">
                <button type="button" className="btn-ghost" aria-label={`move ${labelOf(v)} up`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn-ghost" aria-label={`move ${labelOf(v)} down`} onClick={() => move(i, 1)}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      );
    }
    case 'file': {
      const fileField: Extract<FormField, { type: 'file' }> = field;
      const multi = fileField.maxFiles > 1;

      function validate(file: File): string | null {
        if (!fileField.acceptedMimeTypes.includes(file.type)) {
          return `"${file.type || 'unknown type'}" is not accepted here`;
        }
        if (file.size > fileField.maxSizeMb * 1024 * 1024) {
          return `file exceeds the ${fileField.maxSizeMb}MB limit`;
        }
        return null;
      }

      async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = ''; // allow re-picking the same filename after an error
        if (files.length === 0) return;

        const currentIds = multi ? ((value as string[] | undefined) ?? []) : [];
        if (multi && currentIds.length + files.length > fileField.maxFiles) {
          setUploadState({ busy: false, filename: null, error: `up to ${fileField.maxFiles} files allowed` });
          return;
        }
        for (const file of files) {
          const problem = validate(file);
          if (problem) {
            setUploadState({ busy: false, filename: null, error: problem });
            return;
          }
        }

        setUploadState({ busy: true, filename: null, error: null });
        try {
          const uploaded = await Promise.all(
            files.map((file) => uploadFile<{ id: string; filename: string }>(`${uploadPath}/${fileField.key}`, file)),
          );
          if (multi) {
            setAttachedNames((names) => ({
              ...names,
              ...Object.fromEntries(uploaded.map((u) => [u.id, u.filename])),
            }));
            onChange([...currentIds, ...uploaded.map((u) => u.id)]);
            setUploadState({ busy: false, filename: null, error: null });
          } else {
            setUploadState({ busy: false, filename: uploaded[0]!.filename, error: null });
            onChange(uploaded[0]!.id);
          }
        } catch (cause) {
          const message = cause instanceof ApiRequestError ? cause.message : 'upload failed';
          setUploadState({ busy: false, filename: null, error: message });
        }
      }

      if (multi) {
        const ids = (value as string[] | undefined) ?? [];
        return (
          <div id={id}>
            <input
              type="file"
              multiple
              aria-label={fileField.label}
              accept={fileField.acceptedMimeTypes.join(',')}
              onChange={(e) => void onPick(e)}
              disabled={uploadState.busy || ids.length >= fileField.maxFiles}
            />
            <p className="muted">{ids.length} / {fileField.maxFiles} files</p>
            {ids.length > 0 && (
              <ul className="summary-samples">
                {ids.map((fileId) => (
                  <li key={fileId}>
                    {attachedNames[fileId] ?? 'file attached'}{' '}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onChange(ids.filter((v) => v !== fileId))}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {uploadState.busy && <p className="muted">uploading…</p>}
            {uploadState.error && <p role="alert" className="form-error">{uploadState.error}</p>}
          </div>
        );
      }

      const attachedName = uploadState.filename ?? (value ? 'file attached' : null);
      return (
        <div id={id}>
          <input
            type="file"
            aria-label={fileField.label}
            accept={fileField.acceptedMimeTypes.join(',')}
            onChange={(e) => void onPick(e)}
            disabled={uploadState.busy}
          />
          {uploadState.busy && <p className="muted">uploading…</p>}
          {attachedName && !uploadState.busy && <p className="muted">✓ {attachedName}</p>}
          {uploadState.error && <p role="alert" className="form-error">{uploadState.error}</p>}
        </div>
      );
    }
    case 'slider': {
      const current = (value as number | undefined) ?? field.min;
      return (
        <div className="slider-row" id={id}>
          {field.lowLabel && <span className="muted scale-cap">{field.lowLabel}</span>}
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={current}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={field.label}
          />
          <span className="slider-value muted">{current}</span>
          {field.highLabel && <span className="muted scale-cap">{field.highLabel}</span>}
        </div>
      );
    }
    case 'contact_info': {
      const current = (value as Record<string, string> | undefined) ?? {};
      const set = (part: string, v: string) => onChange({ ...current, [part]: v });
      return (
        <div className="contact-info-grid" id={id}>
          <label htmlFor={`${id}-name`} className="muted">
            name{field.requireName && ' *'}
          </label>
          <input id={`${id}-name`} value={current.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          <label htmlFor={`${id}-email`} className="muted">
            email{field.requireEmail && ' *'}
          </label>
          <input id={`${id}-email`} type="email" value={current.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <label htmlFor={`${id}-phone`} className="muted">
            phone{field.requirePhone && ' *'}
          </label>
          <input id={`${id}-phone`} type="tel" value={current.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </div>
      );
    }
    case 'hot_spot': {
      const current = value as string | undefined;
      return (
        <div className="hot-spot-frame" id={id}>
          <img src={assetUrl(field.imageAssetId)} alt="" className="hot-spot-image" />
          {field.regions.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-label={r.label}
              aria-pressed={current === r.value}
              className={`hot-spot-region${current === r.value ? ' hot-spot-region-active' : ''}`}
              style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
              onClick={() => onChange(r.value)}
            />
          ))}
        </div>
      );
    }
    default:
      return <input id={id} type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export interface SubmissionScore {
  earnedPoints: number;
  totalPoints: number;
  percent: number | null;
  passed: boolean | null;
}

/**
 * MS-Forms-style renderer shared by the portal fill tab and the public page.
 * Handles shuffle, closed/scheduled states, and the custom thank-you message.
 */
export function FormRenderer({
  definition,
  settings,
  onSubmit,
  uploadPath,
  initialAnswers,
  editUrlFor,
}: {
  definition: FormDefinition;
  settings: FormSettings;
  onSubmit: (answers: SubmissionAnswers) => Promise<{ score?: SubmissionScore | null; editToken?: string | null } | void>;
  /** base path for file-field uploads, e.g. "/v1/forms/:slug/uploads" or "/v1/public/forms/:token/uploads" */
  uploadPath: string;
  /** seeds the answer state — used when the respondent arrived via an edit link. */
  initialAnswers?: SubmissionAnswers;
  /** builds the "edit your response" link shown on the thank-you screen from a returned
   *  edit token; omitted entirely when the caller has no page to send the respondent back to. */
  editUrlFor?: (editToken: string) => string;
}) {
  const [answers, setAnswers] = useState<SubmissionAnswers>(initialAnswers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<SubmissionScore | null>(null);
  const [submittedEditToken, setSubmittedEditToken] = useState<string | null>(null);

  const hasSections = Boolean(definition.sections && definition.sections.length > 0);

  // page/block randomization: only coherent for pure linear multi-page forms — if any
  // page branches, the stored (unshuffled) order is what resolveSectionPath's forward-only
  // DAG check validates against, so shuffling would desync from it. Without branching, the
  // *set* of reachable/required fields is order-independent, so this is safe client-side-only.
  const shuffledSections = useMemo(() => {
    const sections = definition.sections;
    if (!sections || sections.length === 0) return sections;
    if (!settings.shuffleSections) return sections;
    const hasBranching = sections.some(
      (s) => s.branching || (s.branchRules && s.branchRules.length > 0),
    );
    if (hasBranching) return sections;
    return [...sections].sort(() => Math.random() - 0.5);
  }, [definition, settings.shuffleSections]);

  const renderDefinition = hasSections ? { ...definition, sections: shuffledSections } : definition;

  const [currentSectionId, setCurrentSectionId] = useState<string | null>(
    renderDefinition.sections?.[0]?.id ?? null,
  );

  const shuffledQuestionOrder = useMemo(() => {
    if (!settings.shuffleQuestions) return definition.fields;
    return [...definition.fields].sort(() => Math.random() - 0.5);
  }, [definition, settings.shuffleQuestions]);

  // a second, independent shuffle layered on top: per-field option order (select/
  // multi_select/ranking), computed once per fill session just like question order above
  const orderedFields = useMemo(
    () =>
      shuffledQuestionOrder.map((field) => {
        if (!('shuffleOptions' in field) || !field.shuffleOptions) return field;
        return { ...field, options: [...field.options].sort(() => Math.random() - 0.5) };
      }),
    [shuffledQuestionOrder],
  );

  // recomputed on every answer change: a branch decision made on the current
  // page can only be resolved once its trigger field has been answered.
  const path = hasSections ? resolveSectionPath(renderDefinition, answers).visitedSectionIds : [];
  const currentIndex = currentSectionId ? Math.max(0, path.indexOf(currentSectionId)) : -1;
  const currentSection = hasSections
    ? (renderDefinition.sections!.find((s) => s.id === path[currentIndex]) ?? renderDefinition.sections![0])
    : undefined;
  const isLastPage = currentIndex === path.length - 1;
  // filtered from the (possibly shuffled) orderedFields, not definition.fields
  // directly, so shuffleQuestions also applies within a page — see orderedFields above
  const pageFields = currentSection
    ? orderedFields.filter((f) => currentSection.fieldKeys.includes(f.key))
    : [];

  const now = Date.now();
  const notYetOpen = settings.opensAt && now < Date.parse(settings.opensAt);
  const closed =
    !settings.acceptingResponses || (settings.closesAt && now > Date.parse(settings.closesAt));

  // hidden/UTM-style fields: read once from the query string and never shown to the
  // respondent — see the capturedFromUrlParam exclusion in visibleFields below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const captured: SubmissionAnswers = {};
    for (const field of definition.fields) {
      if (!field.capturedFromUrlParam) continue;
      const value = params.get(field.capturedFromUrlParam);
      if (value !== null) captured[field.key] = value;
    }
    if (Object.keys(captured).length > 0) {
      setAnswers((prev) => ({ ...captured, ...prev }));
    }
  }, [definition]);

  function pageIsComplete(fields: FormField[]) {
    return fields.every((field) => {
      if (field.capturedFromUrlParam) return true;
      if (!isVisible(field, answers)) return true;
      if (!field.required) return true;
      const value = answers[field.key];
      return value !== undefined && value !== null && value !== '';
    });
  }

  function onNext() {
    if (!pageIsComplete(pageFields)) {
      setPageError('please answer every required question on this page');
      return;
    }
    setPageError(null);
    const next = path[currentIndex + 1];
    if (next) setCurrentSectionId(next);
  }

  function onBack() {
    setPageError(null);
    const prev = path[currentIndex - 1];
    if (prev) setCurrentSectionId(prev);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasSections && !pageIsComplete(pageFields)) {
      setPageError('please answer every required question on this page');
      return;
    }
    setError(null);
    try {
      const reachable = hasSections ? resolveSectionPath(renderDefinition, answers).reachableFieldKeys : null;
      const visible = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          const field = definition.fields.find((f) => f.key === key);
          return (
            field &&
            isVisible(field, answers) &&
            (!reachable || reachable.has(key)) &&
            value !== null &&
            value !== ''
          );
        }),
      );
      const result = await onSubmit(visible);
      setSubmittedScore(result?.score ?? null);
      setSubmittedEditToken(result?.editToken ?? null);
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed');
    }
  }

  const theme = definition.theme;
  const accentStyle = theme?.accentColor ? ({ '--msform-accent': theme.accentColor } as React.CSSProperties) : undefined;
  const bannerStyle = theme?.backgroundAssetId ? { backgroundImage: `url(${assetUrl(theme.backgroundAssetId)})` } : undefined;

  return (
    <div className="msform" style={accentStyle}>
      <header className={`msform-banner${theme?.backgroundAssetId ? ' msform-banner-image' : ''}`} style={bannerStyle}>
        {theme?.logoAssetId && <img src={assetUrl(theme.logoAssetId)} alt="" className="msform-logo" />}
        <h1>{definition.title}</h1>
        {definition.description && <p>{definition.description}</p>}
        {!submitted && !closed && !notYetOpen && <p className="msform-required-hint">* required</p>}
      </header>

      {closed || notYetOpen ? (
        <div className="question-card msform-thanks">
          <h2>{notYetOpen ? 'not open yet' : 'this form is closed'}</h2>
          <p className="muted">
            {notYetOpen
              ? `responses open ${new Date(settings.opensAt!).toLocaleString()}`
              : 'it is no longer accepting responses.'}
          </p>
        </div>
      ) : submitted ? (
        <div className="question-card msform-thanks">
          <h2>{settings.thankYouMessage}</h2>
          <p className="muted">your response was recorded.</p>
          {settings.quizMode && settings.showScoreToRespondent && submittedScore && (
            <p className="quiz-score">
              {submittedScore.percent !== null ? (
                <>
                  score: <strong>{submittedScore.earnedPoints}</strong> / {submittedScore.totalPoints} (
                  {submittedScore.percent}%)
                  {submittedScore.passed !== null && (
                    <span className={submittedScore.passed ? 'quiz-passed' : 'quiz-failed'}>
                      {' '}
                      — {submittedScore.passed ? 'passed' : 'did not pass'}
                    </span>
                  )}
                </>
              ) : (
                'this quiz has no graded questions'
              )}
            </p>
          )}
          {submittedEditToken && editUrlFor && (
            <p className="muted">
              <a href={editUrlFor(submittedEditToken)}>edit your response</a>
            </p>
          )}
          <button
            className="btn-ghost"
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
              setSubmittedScore(null);
              setSubmittedEditToken(null);
            }}
          >
            submit another response
          </button>
        </div>
      ) : (
        <form className="fill-form msform-body" onSubmit={handleSubmit}>
          {hasSections && (
            <div style={{ marginBottom: 8 }}>
              <p className="muted" style={{ margin: 0 }}>
                page {currentIndex + 1} of {path.length}
                {currentSection?.title ? ` — ${currentSection.title}` : ''}
              </p>
              {currentSection?.description && <p className="muted">{currentSection.description}</p>}
              {currentSection?.media && <FieldMedia media={currentSection.media} />}
            </div>
          )}
          {(() => {
            const visibleFields = (hasSections ? pageFields : orderedFields).filter(
              (field) => isVisible(field, answers) && !field.capturedFromUrlParam,
            );
            let questionNumber = 0;
            return visibleFields.map((field) => {
              const label = applyPiping(field.label, answers);
              const helpText = field.helpText ? applyPiping(field.helpText, answers) : undefined;
              if (field.type === 'section_header') {
                return (
                  <div key={field.key} className="question-card section-header-card">
                    <h2 className="section-header-title">{label}</h2>
                    {helpText && <p className="muted">{helpText}</p>}
                  </div>
                );
              }
              questionNumber += 1;
              return (
                <div key={field.key} className="question-card">
                  {field.media && <FieldMedia media={field.media} />}
                  <label htmlFor={`f-${field.key}`} className="question-title" id={`f-${field.key}-label`}>
                    <span className="question-number">{questionNumber}.</span> {label}
                    {field.required && <span aria-hidden="true" className="question-required"> *</span>}
                  </label>
                  {helpText && <p className="muted">{helpText}</p>}
                  <FieldInput field={field} value={answers[field.key]} uploadPath={uploadPath}
                    onChange={(value) => setAnswers((a) => ({ ...a, [field.key]: value }))} />
                </div>
              );
            });
          })()}
          {(pageError || error) && (
            <p role="alert" className="form-error">{pageError ?? error}</p>
          )}
          <div className="page-title-row">
            {hasSections && currentIndex > 0 && (
              <button type="button" className="btn-ghost" onClick={onBack}>
                ← back
              </button>
            )}
            {hasSections && !isLastPage ? (
              <button type="button" className="btn-primary" onClick={onNext}>
                next →
              </button>
            ) : (
              <button className="btn-primary" type="submit">submit</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
