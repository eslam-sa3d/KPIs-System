'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { FormDefinition, FormField, FormSettings, SubmissionAnswers } from '@pulse/contracts';

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

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
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
              <span>{i + 1}. {labelOf(v)}</span>
              <span className="ranking-controls">
                <button type="button" className="btn-ghost" aria-label={`move ${labelOf(v)} up`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn-ghost" aria-label={`move ${labelOf(v)} down`} onClick={() => move(i, 1)}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      );
    }
    default:
      return <input id={id} type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/**
 * MS-Forms-style renderer shared by the portal fill tab and the public page.
 * Handles shuffle, closed/scheduled states, and the custom thank-you message.
 */
export function FormRenderer({
  definition,
  settings,
  onSubmit,
}: {
  definition: FormDefinition;
  settings: FormSettings;
  onSubmit: (answers: SubmissionAnswers) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<SubmissionAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const orderedFields = useMemo(() => {
    if (!settings.shuffleQuestions) return definition.fields;
    return [...definition.fields].sort(() => Math.random() - 0.5);
  }, [definition, settings.shuffleQuestions]);

  const now = Date.now();
  const notYetOpen = settings.opensAt && now < Date.parse(settings.opensAt);
  const closed =
    !settings.acceptingResponses || (settings.closesAt && now > Date.parse(settings.closesAt));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const visible = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          const field = definition.fields.find((f) => f.key === key);
          return field && isVisible(field, answers) && value !== null && value !== '';
        }),
      );
      await onSubmit(visible);
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
          <button className="btn-ghost" onClick={() => { setAnswers({}); setSubmitted(false); }}>
            submit another response
          </button>
        </div>
      ) : (
        <form className="fill-form msform-body" onSubmit={handleSubmit}>
          {orderedFields.filter((field) => isVisible(field, answers)).map((field, index) => (
            <div key={field.key} className="question-card">
              <label htmlFor={`f-${field.key}`} className="question-title" id={`f-${field.key}-label`}>
                <span className="question-number">{index + 1}.</span> {field.label}
                {field.required && <span aria-hidden="true" className="question-required"> *</span>}
              </label>
              {field.helpText && <p className="muted">{field.helpText}</p>}
              <FieldInput field={field} value={answers[field.key]}
                onChange={(value) => setAnswers((a) => ({ ...a, [field.key]: value }))} />
            </div>
          ))}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div>
            <button className="btn-primary" type="submit">submit</button>
          </div>
        </form>
      )}
    </div>
  );
}
