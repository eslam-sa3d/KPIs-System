'use client';

import { useEffect } from 'react';
import type { FormDefinition, SubmissionAnswers } from '@pulse/contracts';

export interface DetailedSubmission {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string } | null;
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
  onClose,
  onPrev,
  onNext,
}: {
  definition: FormDefinition;
  submission: DetailedSubmission;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

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
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="close">
            close
          </button>
        </div>
        <div className="response-modal-body">
          <dl>
            {definition.fields.map((field) => (
              <div key={field.key} className="response-modal-qa">
                <dt>{field.label}</dt>
                <dd>{formatAnswer(submission.answers[field.key])}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="response-modal-footer">
          <button className="btn-ghost" onClick={() => onPrev?.()} disabled={!onPrev}>
            ← previous
          </button>
          <button className="btn-ghost" onClick={() => onNext?.()} disabled={!onNext}>
            next →
          </button>
        </div>
      </div>
    </div>
  );
}
