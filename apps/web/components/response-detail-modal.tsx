'use client';

import { useEffect, useState } from 'react';
import type { FormDefinition, SubmissionAnswers } from '@pulse/contracts';
import { api, downloadFile } from '../lib/api-client';
import { FieldInput, type SubmissionScore } from './form-renderer';

export interface DetailedSubmission {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string } | null;
  score?: SubmissionScore | null;
}

function formatAnswer(value: SubmissionAnswers[string] | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
  return String(value);
}

/** Single-response detail, paged prev/next through the filtered submissions list. */
export function ResponseDetailModal({
  definition,
  submission,
  index,
  total,
  slug,
  canEdit,
  onClose,
  onPrev,
  onNext,
  onSaved,
}: {
  definition: FormDefinition;
  submission: DetailedSubmission;
  index: number;
  total: number;
  /** form slug — needed to build the authenticated file-download URL */
  slug: string;
  /** admin-correction: requires form_submissions:manage, same bar as delete */
  canEdit: boolean;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onSaved: (updated: DetailedSubmission) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SubmissionAnswers>(submission.answers);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(submission.answers);
    setSaveError(null);
  }, [submission]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) return; // don't hijack arrow keys / escape while correcting an answer
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose, onPrev, onNext]);

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api<DetailedSubmission>(`/v1/forms/${slug}/submissions/${submission.id}`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      });
      onSaved({ ...submission, ...updated });
      setEditing(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Saving failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="response-modal-backdrop" onClick={onClose}>
      <div
        className="response-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="response detail"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="response-modal-header">
          <div>
            <h2>response {index + 1} of {total}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {submission.submittedBy?.displayName ?? 'anonymous'} ·{' '}
              {new Date(submission.createdAt).toLocaleString()}
            </p>
            {submission.score && submission.score.percent !== null && (
              <p className="quiz-score" style={{ margin: '4px 0 0', fontSize: 'var(--font-size-md)' }}>
                score: <strong>{submission.score.earnedPoints}</strong> / {submission.score.totalPoints} (
                {submission.score.percent}%)
                {submission.score.passed !== null && (
                  <span className={submission.score.passed ? 'quiz-passed' : 'quiz-failed'}>
                    {' '}
                    — {submission.score.passed ? 'passed' : 'did not pass'}
                  </span>
                )}
              </p>
            )}
          </div>
          <span className="builder-field-actions">
            {canEdit && !editing && (
              <button className="btn-ghost" onClick={() => setEditing(true)}>
                edit
              </button>
            )}
            <button className="btn-ghost" onClick={onClose} aria-label="close">
              close
            </button>
          </span>
        </div>
        <div className="response-modal-body">
          {editing ? (
            <div className="builder">
              {definition.fields
                .filter((f) => f.type !== 'section_header')
                .map((field) => (
                  <div key={field.key} className="question-card">
                    <label htmlFor={`edit-${field.key}`} className="question-title">
                      {field.label}
                    </label>
                    <FieldInput
                      field={field}
                      value={draft[field.key]}
                      uploadPath={`/v1/forms/${slug}/uploads`}
                      onChange={(value) => setDraft((d) => ({ ...d, [field.key]: value }))}
                    />
                  </div>
                ))}
              {saveError && (
                <p role="alert" className="form-error">
                  {saveError}
                </p>
              )}
            </div>
          ) : (
            <dl>
              {definition.fields.map((field) => {
                const value = submission.answers[field.key];
                return (
                  <div key={field.key} className="response-modal-qa">
                    <dt>{field.label}</dt>
                    <dd>
                      {field.type === 'file' && typeof value === 'string' && value ? (
                        <button
                          className="btn-ghost"
                          onClick={() => downloadFile(`/v1/forms/${slug}/uploads/${value}`, field.label)}
                        >
                          download attachment
                        </button>
                      ) : field.type === 'file' && Array.isArray(value) && value.length > 0 ? (
                        <span className="builder-field-actions">
                          {value.map((uploadId, i) => (
                            <button
                              key={uploadId}
                              className="btn-ghost"
                              onClick={() => downloadFile(`/v1/forms/${slug}/uploads/${uploadId}`, `${field.label}-${i + 1}`)}
                            >
                              download {i + 1}
                            </button>
                          ))}
                        </span>
                      ) : (
                        formatAnswer(value)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        <div className="response-modal-footer">
          {editing ? (
            <>
              <button className="btn-ghost" onClick={() => { setEditing(false); setDraft(submission.answers); setSaveError(null); }}>
                cancel
              </button>
              <button className="btn-primary" disabled={saving} onClick={onSave}>
                {saving ? 'saving…' : 'save'}
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => onPrev?.()} disabled={!onPrev}>
                ← previous
              </button>
              <button className="btn-ghost" onClick={() => onNext?.()} disabled={!onNext}>
                next →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
