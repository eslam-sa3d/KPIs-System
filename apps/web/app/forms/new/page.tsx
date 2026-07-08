'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FieldType } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

/** Field types creatable from the UI (file uploads come later). */
const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'short_text', label: 'short text' },
  { value: 'long_text', label: 'long text' },
  { value: 'number', label: 'number' },
  { value: 'date', label: 'date' },
  { value: 'boolean', label: 'yes / no' },
  { value: 'rating', label: 'rating (1–5)' },
  { value: 'select', label: 'dropdown' },
  { value: 'multi_select', label: 'multi-select' },
];

interface DraftField {
  label: string;
  type: FieldType;
  required: boolean;
  /** comma-separated, for select/multi_select */
  options: string;
}

const emptyField = (): DraftField => ({ label: '', type: 'short_text', required: false, options: '' });

const toKey = (label: string, index: number) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `field_${index + 1}${slug ? `_${slug}` : ''}`;
};

function toDefinitionField(draft: DraftField, index: number) {
  const base = { key: toKey(draft.label, index), label: draft.label, required: draft.required };
  switch (draft.type) {
    case 'select':
    case 'multi_select': {
      const options = draft.options
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean)
        .map((option) => ({ value: option, label: option }));
      return { ...base, type: draft.type, options };
    }
    case 'rating':
      return { ...base, type: draft.type, scale: 5 };
    default:
      return { ...base, type: draft.type };
  }
}

export default function NewFormPage() {
  const user = useSession();
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ slug: string } | null>(null);

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  async function onPublish() {
    setError(null);
    try {
      const slug = `${toKey(title, 0)}-${Date.now().toString(36)}`.replace(/_/g, '-');
      const form = await api<{ slug: string }>('/v1/forms', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          definition: { title, fields: fields.map(toDefinitionField) },
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

            {(field.type === 'select' || field.type === 'multi_select') && (
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

            <span className="builder-required">
              <input
                id={`field-required-${index}`}
                type="checkbox"
                checked={field.required}
                onChange={(e) => updateField(index, { required: e.target.checked })}
              />
              <label htmlFor={`field-required-${index}`}>required</label>
            </span>

            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
            >
              remove field
            </button>
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
