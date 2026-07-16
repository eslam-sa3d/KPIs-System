'use client';

import { FormEvent, memo, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  PIPE_TAG_PATTERN,
  resolveSectionPath,
  type FormDefinition,
  type FormField,
  type FormSettings,
  type QuizScore,
  type SubmissionAnswers,
} from '@pulse/contracts';
import { api, assetUrl } from '../lib/api-client';
import { resolvePersonAnswer, resolvePerformanceLevelAnswer } from '../lib/resolve-person-answer';
import type { Media } from '@pulse/contracts';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ContactInfoField } from './form-fields/contact-info-field';
import { FileField } from './form-fields/file-field';
import { GridField } from './form-fields/grid-field';
import { HotSpotField } from './form-fields/hot-spot-field';
import { LikertField } from './form-fields/likert-field';
import { MultiSelectField } from './form-fields/multi-select-field';
import { PerformanceLevelField } from './form-fields/performance-level-field';
import { PersonField } from './form-fields/person-field';
import { RankingField } from './form-fields/ranking-field';
import { RatingField } from './form-fields/rating-field';
import { SelectField } from './form-fields/select-field';

interface UserOption {
  id: string;
  email: string;
  displayName: string;
}

interface PerformanceLevelOption {
  id: string;
  label: string;
}

// Plain <img>, not next/image, throughout this file: apps/web is a static
// export with images.unoptimized (no resize/format server to call), and
// every image here is an arbitrary-dimension respondent/admin upload shown
// inside a max-width/max-height + object-fit:contain box — next/image needs
// either known dimensions or a sized `fill` ancestor, neither of which fits
// without either guessing a wrong aspect ratio (causing the very layout
// shift it's meant to prevent) or restructuring this CSS. loading="lazy" is
// the real, low-risk win available under these constraints.
function FieldMedia({ media }: { media: Media }) {
  if (media.type === 'image' && media.assetId) {
    return <img src={assetUrl(media.assetId)} alt={media.alt ?? ''} className="question-media-image" loading="lazy" />;
  }
  if (media.type === 'video' && media.url) {
    return (
      <iframe src={media.url} title={media.alt ?? 'Question video'} className="question-media-video" allowFullScreen />
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

/** Resolves one piped-in answer to displayable text — a 'person'/'performance_level'
 *  answer (or a select/multi_select/ranking option built via the "link to a user"
 *  picker) is stored as an id, not the label a respondent should see. */
function resolvePipedValue(
  value: SubmissionAnswers[string] | undefined,
  field: FormField | undefined,
  personNames: Record<string, string>,
  performanceLevelLabels: Record<string, string>,
): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object' && !Array.isArray(value)) return ''; // compound answers (likert/contact_info) aren't piped
  const optionLabels =
    field && (field.type === 'select' || field.type === 'multi_select' || field.type === 'ranking')
      ? Object.fromEntries(field.options.map((o) => [o.value, o.label]))
      : undefined;
  const resolveScalar = (v: string): string => {
    if (field?.type === 'performance_level') return resolvePerformanceLevelAnswer(v, performanceLevelLabels);
    if (optionLabels) return optionLabels[v] ?? v;
    return resolvePersonAnswer(v, personNames, field?.type === 'person');
  };
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? resolveScalar(v) : String(v))).join(', ');
  }
  return resolveScalar(String(value));
}

/** Answer piping: replaces every {{field_key}} in a label/helpText with that
 *  field's current in-progress answer — blank until answered, never the raw tag. */
export function applyPiping(
  text: string,
  answers: SubmissionAnswers,
  fieldByKey: Map<string, FormField>,
  personNames: Record<string, string>,
  performanceLevelLabels: Record<string, string>,
): string {
  return text.replace(PIPE_TAG_PATTERN, (_match, key: string) =>
    resolvePipedValue(answers[key], fieldByKey.get(key), personNames, performanceLevelLabels),
  );
}

/** Exported for reuse by ResponseDetailModal's edit mode — same input for filling and correcting.
 *  Memoized so that typing into one field doesn't re-render every other field's input on every
 *  keystroke — FormRenderer hands each instance a stable per-field onChange (see
 *  getFieldChangeHandler below) so this actually has a chance to skip re-rendering. */
export const FieldInput = memo(function FieldInput({
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

  switch (field.type) {
    case 'long_text':
      return <Textarea id={id} rows={4} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return <Input id={id} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'time':
      return <Input id={id} type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return <Checkbox id={id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} />;
    case 'rating':
      return <RatingField field={field} value={value} onChange={onChange} />;
    case 'nps': {
      const current = value as number | undefined;
      return (
        <div className="scale-row" role="radiogroup" id={id}>
          <span className="muted scale-cap">{field.lowLabel}</span>
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              className={`scale-pill${current === n ? ' scale-pill-active' : ''}`}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
          <span className="muted scale-cap">{field.highLabel}</span>
        </div>
      );
    }
    case 'select':
      return <SelectField field={field} value={value} onChange={onChange} />;
    case 'multi_select':
      return <MultiSelectField field={field} value={value} onChange={onChange} />;
    case 'likert':
      return <LikertField field={field} value={value} onChange={onChange} />;
    case 'grid':
      return <GridField field={field} value={value} onChange={onChange} />;
    case 'ranking':
      return <RankingField field={field} value={value} onChange={onChange} />;
    case 'file':
      return <FileField field={field} value={value} onChange={onChange} uploadPath={uploadPath} />;
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
    case 'contact_info':
      return <ContactInfoField field={field} value={value} onChange={onChange} />;
    case 'hot_spot':
      return <HotSpotField field={field} value={value} onChange={onChange} />;
    case 'person':
      return <PersonField field={field} value={value} onChange={onChange} />;
    case 'performance_level':
      return <PerformanceLevelField field={field} value={value} onChange={onChange} />;
    default:
      return <Input id={id} type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
});

export type SubmissionScore = QuizScore;

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
  captchaSlot,
}: {
  definition: FormDefinition;
  settings: FormSettings;
  onSubmit: (
    answers: SubmissionAnswers,
  ) => Promise<{ score?: SubmissionScore | null; editToken?: string | null } | void>;
  /** base path for file-field uploads, e.g. "/v1/forms/:slug/uploads" or "/v1/public/forms/:token/uploads" */
  uploadPath: string;
  /** seeds the answer state — used when the respondent arrived via an edit link. */
  initialAnswers?: SubmissionAnswers;
  /** builds the "edit your response" link shown on the thank-you screen from a returned
   *  edit token; omitted entirely when the caller has no page to send the respondent back to. */
  editUrlFor?: (editToken: string) => string;
  /** rendered above the submit button on the final page — the page's Turnstile widget when
   *  settings.requireCaptcha is on; omitted for callers that don't wire up CAPTCHA. */
  captchaSlot?: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<SubmissionAnswers>(initialAnswers ?? {});
  // One stable onChange closure per field key, reused across renders (rather
  // than a fresh arrow function per field per render) so memo(FieldInput)
  // above can actually skip re-rendering every other field when one changes.
  const fieldChangeHandlers = useRef(new Map<string, (value: SubmissionAnswers[string]) => void>());
  function getFieldChangeHandler(key: string) {
    let handler = fieldChangeHandlers.current.get(key);
    if (!handler) {
      handler = (value) => setAnswers((a) => ({ ...a, [key]: value }));
      fieldChangeHandlers.current.set(key, handler);
    }
    return handler;
  }
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<SubmissionScore | null>(null);
  const [submittedEditToken, setSubmittedEditToken] = useState<string | null>(null);

  const hasSections = Boolean(definition.sections && definition.sections.length > 0);
  // the "* required" legend only means something if at least one question actually uses it
  const hasRequiredField = definition.fields.some((f) => f.required);

  // page/block randomization: only coherent for pure linear multi-page forms — if any
  // page branches, the stored (unshuffled) order is what resolveSectionPath's forward-only
  // DAG check validates against, so shuffling would desync from it. Without branching, the
  // *set* of reachable/required fields is order-independent, so this is safe client-side-only.
  const shuffledSections = useMemo(() => {
    const sections = definition.sections;
    if (!sections || sections.length === 0) return sections;
    if (!settings.shuffleSections) return sections;
    const fieldByKey = new Map(definition.fields.map((f) => [f.key, f]));
    const hasBranching = sections.some(
      (s) =>
        s.branching ||
        (s.branchRules && s.branchRules.length > 0) ||
        s.defaultGoTo !== undefined ||
        s.fieldKeys.some((key) => {
          const field = fieldByKey.get(key);
          return field?.type === 'select' && field.optionGoTo && Object.keys(field.optionGoTo).length > 0;
        }),
    );
    if (hasBranching) return sections;
    return [...sections].sort(() => Math.random() - 0.5);
  }, [definition, settings.shuffleSections]);

  const renderDefinition = hasSections ? { ...definition, sections: shuffledSections } : definition;

  const [currentSectionId, setCurrentSectionId] = useState<string | null>(renderDefinition.sections?.[0]?.id ?? null);

  // frozen per page: only re-resolved on explicit navigation (onNext/onBack), not on every
  // answer change on the currently displayed page. Recomputing this live from `answers` let
  // a branch rule resolve to "end of form" the instant its trigger field was answered, which
  // silently swapped the "next →" button into a "submit" button in the same spot the
  // respondent was about to click — submitting the form with no review step.
  const [path, setPath] = useState<string[]>(() =>
    hasSections ? resolveSectionPath(renderDefinition, initialAnswers ?? {}).visitedSectionIds : [],
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

  // Answer piping ({{field_key}}) needs to resolve 'person'/'performance_level' answers
  // to a name/label, not show the raw id — fetched once per form load, gated on the form
  // actually having one of these field types, same gating FieldInput uses per-instance.
  const fieldByKey = useMemo(() => new Map(definition.fields.map((f) => [f.key, f])), [definition]);
  const [pipingPersonNames, setPipingPersonNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!definition.fields.some((f) => f.type === 'person')) return;
    let cancelled = false;
    api<UserOption[]>('/v1/users?pageSize=200')
      .then((users) => {
        if (!cancelled) setPipingPersonNames(Object.fromEntries(users.map((u) => [u.id, u.displayName])));
      })
      .catch(() => {
        if (!cancelled) setPipingPersonNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [definition]);
  const [pipingPerformanceLevelLabels, setPipingPerformanceLevelLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!definition.fields.some((f) => f.type === 'performance_level')) return;
    let cancelled = false;
    api<PerformanceLevelOption[]>('/v1/performance-levels')
      .then((levels) => {
        if (!cancelled) setPipingPerformanceLevelLabels(Object.fromEntries(levels.map((l) => [l.id, l.label])));
      })
      .catch(() => {
        if (!cancelled) setPipingPerformanceLevelLabels({});
      });
    return () => {
      cancelled = true;
    };
  }, [definition]);

  const currentIndex = currentSectionId ? Math.max(0, path.indexOf(currentSectionId)) : -1;
  const currentSection = hasSections
    ? (renderDefinition.sections!.find((s) => s.id === path[currentIndex]) ?? renderDefinition.sections![0])
    : undefined;
  const isLastPage = currentIndex === path.length - 1;
  // filtered from the (possibly shuffled) orderedFields, not definition.fields
  // directly, so shuffleQuestions also applies within a page — see orderedFields above
  const pageFields = currentSection ? orderedFields.filter((f) => currentSection.fieldKeys.includes(f.key)) : [];

  const now = Date.now();
  const notYetOpen = settings.opensAt && now < Date.parse(settings.opensAt);
  const closed = !settings.acceptingResponses || (settings.closesAt && now > Date.parse(settings.closesAt));

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
      if (hasSections) {
        setPath(resolveSectionPath(renderDefinition, captured).visitedSectionIds);
      }
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
      setPageError('Please answer every required question on this page');
      return;
    }
    setPageError(null);
    // re-resolve now that this page's fields (including any branch trigger) are answered
    const freshPath = resolveSectionPath(renderDefinition, answers).visitedSectionIds;
    setPath(freshPath);
    const idx = currentSectionId ? freshPath.indexOf(currentSectionId) : -1;
    const next = freshPath[idx + 1];
    // if branching resolved to end-of-form here, this click only reveals the submit button —
    // it does not submit on the respondent's behalf.
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
      setPageError('Please answer every required question on this page');
      return;
    }
    setError(null);
    try {
      const reachable = hasSections ? resolveSectionPath(renderDefinition, answers).reachableFieldKeys : null;
      const visible = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          const field = definition.fields.find((f) => f.key === key);
          return (
            field && isVisible(field, answers) && (!reachable || reachable.has(key)) && value !== null && value !== ''
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

  return (
    <div className="msform">
      <header className="msform-banner">
        <h1>{definition.title}</h1>
        {definition.description && <p>{definition.description}</p>}
        {!submitted && !closed && !notYetOpen && hasRequiredField && <p className="msform-required-hint">* required</p>}
      </header>

      {closed || notYetOpen ? (
        <div className="question-card msform-thanks">
          <h2>{notYetOpen ? 'Not open yet' : 'This form is closed'}</h2>
          <p className="muted">
            {notYetOpen
              ? `Responses open ${new Date(settings.opensAt!).toLocaleString()}`
              : 'It is no longer accepting responses.'}
          </p>
        </div>
      ) : submitted ? (
        <div className="question-card msform-thanks">
          <CheckCircle2 size={40} aria-hidden="true" className="msform-thanks-icon" />
          <h2>{settings.thankYouMessage}</h2>
          <p className="muted">Your response was recorded.</p>
          {settings.quizMode && settings.showScoreToRespondent && submittedScore && (
            <p className="quiz-score">
              {submittedScore.percent !== null ? (
                <>
                  score: <strong>{submittedScore.earnedPoints}</strong> / {submittedScore.totalPoints} (
                  {submittedScore.percent}%)
                  {submittedScore.passed !== null && (
                    <span className={submittedScore.passed ? 'quiz-passed' : 'quiz-failed'}>
                      {' '}
                      — {submittedScore.passed ? 'Passed' : 'Did not pass'}
                    </span>
                  )}
                </>
              ) : (
                'This quiz has no graded questions'
              )}
            </p>
          )}
          {settings.quizMode &&
            settings.showScoreToRespondent &&
            submittedScore?.perField &&
            Object.keys(submittedScore.perField).length > 0 && (
              <details className="quiz-feedback">
                <summary>See feedback</summary>
                <ul>
                  {Object.entries(submittedScore.perField).map(([key, outcome]) => {
                    const field = definition.fields.find((f) => f.key === key);
                    return (
                      <li key={key}>
                        <span className={outcome.correct ? 'quiz-passed' : 'quiz-failed'}>
                          {field?.label ?? key} — {outcome.correct ? 'Correct' : 'Incorrect'}
                        </span>
                        {outcome.feedback && <p className="muted">{outcome.feedback}</p>}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          {submittedEditToken && editUrlFor && (
            <p className="muted">
              <a href={editUrlFor(submittedEditToken)}>Edit your response</a>
            </p>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
              setSubmittedScore(null);
              setSubmittedEditToken(null);
              // Otherwise a multi-page form reopens on whatever section the
              // respondent submitted from, instead of back at the first page.
              if (hasSections) {
                const freshPath = resolveSectionPath(renderDefinition, {}).visitedSectionIds;
                setPath(freshPath);
                setCurrentSectionId(freshPath[0] ?? null);
              }
              window.scrollTo({ top: 0 });
            }}
          >
            Submit another response
          </Button>
        </div>
      ) : (
        <form
          className="fill-form msform-body"
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            // block HTML's implicit submit-on-Enter for text-like inputs — without this,
            // hitting Enter while answering (e.g. the last question) silently activates the
            // Submit button and posts in-progress answers with no click and no review step.
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
            }
          }}
        >
          {hasSections && (
            <div style={{ marginBottom: 8 }}>
              <p className="muted" style={{ margin: 0 }}>
                Page {currentIndex + 1} of {path.length}
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
              const label = applyPiping(
                field.label,
                answers,
                fieldByKey,
                pipingPersonNames,
                pipingPerformanceLevelLabels,
              );
              const helpText = field.helpText
                ? applyPiping(field.helpText, answers, fieldByKey, pipingPersonNames, pipingPerformanceLevelLabels)
                : undefined;
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
                    {field.required && (
                      <span aria-hidden="true" className="question-required">
                        {' '}
                        *
                      </span>
                    )}
                  </label>
                  {helpText && <p className="muted">{helpText}</p>}
                  <FieldInput
                    field={field}
                    value={answers[field.key]}
                    uploadPath={uploadPath}
                    onChange={getFieldChangeHandler(field.key)}
                  />
                </div>
              );
            });
          })()}
          {(pageError || error) && (
            <Alert variant="destructive">
              <AlertDescription>{pageError ?? error}</AlertDescription>
            </Alert>
          )}
          {(!hasSections || isLastPage) && captchaSlot}
          <div className="page-title-row">
            {hasSections && currentIndex > 0 && (
              <Button type="button" variant="ghost" onClick={onBack}>
                ← back
              </Button>
            )}
            {hasSections && !isLastPage ? (
              // Distinct `key`s force React to unmount/remount rather than mutate this
              // button's type in place — reusing the same DOM node and flipping
              // type="button" -> type="submit" as a side effect of THIS click's own
              // handler let the browser's native default-action phase (which reads the
              // button's type after React's synchronous re-render) submit the form on
              // the very click that was only supposed to navigate to the next page.
              <Button key="next" type="button" onClick={onNext}>
                Next →
              </Button>
            ) : (
              <Button key="submit" type="submit">
                Submit
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
