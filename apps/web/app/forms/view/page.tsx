'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import type { FormDefinition, FormField, SubmissionAnswers } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { api, downloadFile } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface FormDetail {
  form: { id: string; slug: string; status: string };
  version: { id: string; version: number };
  definition: FormDefinition;
}

interface SubmissionRow {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string };
}

const isVisible = (field: FormField, answers: SubmissionAnswers) =>
  !field.visibleWhen || answers[field.visibleWhen.fieldKey] === field.visibleWhen.equals;

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
      return (
        <textarea
          id={id}
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input
          id={id}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'rating':
      return (
        <select
          id={id}
          value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">—</option>
          {Array.from({ length: field.scale }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    case 'select':
      return (
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'multi_select': {
      const selected = (value as string[] | undefined) ?? [];
      return (
        <span className="check-group" id={id}>
          {field.options.map((o) => (
            <label key={o.value} className="check-item">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, o.value]
                      : selected.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </span>
      );
    }
    default:
      // short_text, file (answer = stored object key)
      return (
        <input
          id={id}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function FormView() {
  const user = useSession();
  const slug = useSearchParams().get('slug') ?? '';
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [tab, setTab] = useState<'form' | 'submissions'>('form');
  const [answers, setAnswers] = useState<SubmissionAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (user && slug) void api<FormDetail>(`/v1/forms/${encodeURIComponent(slug)}`).then(setDetail);
  }, [user, slug]);

  useEffect(() => {
    if (user && slug && tab === 'submissions') {
      void api<SubmissionRow[]>(`/v1/forms/${encodeURIComponent(slug)}/submissions?pageSize=100`).then(
        setRows,
      );
    }
  }, [user, slug, tab]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const visible = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          const field = detail?.definition.fields.find((f) => f.key === key);
          return field && isVisible(field, answers) && value !== null && value !== '';
        }),
      );
      await api(`/v1/forms/${encodeURIComponent(slug)}/submissions`, {
        method: 'POST',
        body: JSON.stringify(visible),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed');
    }
  }

  if (!detail) {
    return (
      <PortalShell user={user}>
        <p className="muted">loading…</p>
      </PortalShell>
    );
  }

  const { definition } = detail;
  const filteredRows = (rows ?? []).filter((row) => {
    if (!filter) return true;
    const haystack = [
      row.submittedBy.displayName,
      row.submittedBy.email,
      ...Object.values(row.answers).map((v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''))),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  return (
    <PortalShell user={user}>
      <div role="tablist" className="tabs" aria-label="form views">
        <button role="tab" aria-selected={tab === 'form'} onClick={() => setTab('form')}>
          form
        </button>
        <button
          role="tab"
          aria-selected={tab === 'submissions'}
          onClick={() => setTab('submissions')}
        >
          submissions
        </button>
      </div>

      {tab === 'form' ? (
        <div className="msform">
          {/* MS-Forms-style banner card */}
          <header className="msform-banner">
            <h1>{definition.title}</h1>
            {definition.description && <p>{definition.description}</p>}
            {!submitted && <p className="msform-required-hint">* required</p>}
          </header>

          {submitted ? (
            <div className="question-card msform-thanks">
              <h2>thank you!</h2>
              <p className="muted">your response was recorded.</p>
              <button
                className="btn-ghost"
                onClick={() => {
                  setAnswers({});
                  setSubmitted(false);
                }}
              >
                submit another response
              </button>
            </div>
          ) : (
            <form className="fill-form msform-body" onSubmit={onSubmit}>
              {definition.fields.filter((field) => isVisible(field, answers)).map((field, index) => (
                <div key={field.key} className="question-card">
                  <label htmlFor={`f-${field.key}`} className="question-title">
                    <span className="question-number">{index + 1}.</span> {field.label}
                    {field.required && (
                      <span aria-hidden="true" className="question-required">
                        {' '}*
                      </span>
                    )}
                  </label>
                  {field.helpText && <p className="muted">{field.helpText}</p>}
                  <FieldInput
                    field={field}
                    value={answers[field.key]}
                    onChange={(value) => setAnswers((a) => ({ ...a, [field.key]: value }))}
                  />
                </div>
              ))}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <div>
                <button className="btn-primary" type="submit">
                  submit
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <section role="tabpanel" aria-label="submissions">
          <div className="page-title-row">
            <input
              aria-label="filter submissions"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="btn-ghost"
              onClick={() => downloadFile(`/v1/forms/${slug}/submissions/export`, `${slug}.csv`)}
            >
              export CSV
            </button>
          </div>
          {rows === null ? (
            <p className="muted">loading…</p>
          ) : filteredRows.length === 0 ? (
            <p className="muted">no submissions{filter ? ' match the filter' : ' yet'}.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>submitted</th>
                  <th>by</th>
                  {definition.fields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.submittedBy.displayName}</td>
                    {definition.fields.map((f) => {
                      const value = row.answers[f.key];
                      return (
                        <td key={f.key}>
                          {Array.isArray(value) ? value.join(', ') : String(value ?? '—')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </PortalShell>
  );
}

export default function FormViewPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <Suspense fallback={null}>
      <FormView />
    </Suspense>
  );
}
