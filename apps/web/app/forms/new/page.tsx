'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FieldType } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

/** Field types creatable from the UI (file uploads need object storage — later). */
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
});

const toKey = (label: string, index: number) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`;
};

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

        <div className="page-title-row">
          <button
            type="button"
            className="btn-primary"
            onClick={onPublish}
            disabled={!title.trim() || fields.length === 0 || fields.some((f) => !f.label.trim())}
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
