'use client';

import { useEffect, useState } from 'react';
import type { FormDefinition, FormField, SubmissionAnswers } from '@pulse/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, downloadFile } from '../lib/api-client';
import { resolvePersonAnswer, resolvePerformanceLevelAnswer, resolveScoreLabelAnswer } from '../lib/resolve-person-answer';
import { FieldInput, type SubmissionScore } from './form-renderer';

export interface DetailedSubmission {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string } | null;
  score?: SubmissionScore | null;
}

function formatAnswer(
  value: SubmissionAnswers[string] | undefined,
  field: FormField,
  personNames: Record<string, string>,
  performanceLevelLabels: Record<string, string>,
  scoreLabelLabels: Record<string, string>,
): string {
  if (value === undefined || value === null || value === '') return '—';
  // 'performance_level'/'score_label' answers are a PerformanceLevel/ScoreLabel
  // id; 'person' (or UUID-shaped) answers are a User's id — none is a
  // displayable string as stored, so resolve to a label/name, the same
  // resolution the submissions table applies.
  if (typeof value === 'string') {
    if (field.type === 'performance_level') return resolvePerformanceLevelAnswer(value, performanceLevelLabels);
    if (field.type === 'score_label') return resolveScoreLabelAnswer(value, scoreLabelLabels);
    return resolvePersonAnswer(value, personNames, field.type === 'person');
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? resolvePersonAnswer(item, personNames, false) : String(item)))
      .join(', ');
  }
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
  personNames,
  performanceLevelLabels,
  scoreLabelLabels,
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
  /** 'person' field id -> display name, so a picked evaluatee shows their name, not their id */
  personNames: Record<string, string>;
  /** PerformanceLevel id -> label, so a 'performance_level' answer shows e.g.
   *  "Outstanding" instead of the raw id */
  performanceLevelLabels: Record<string, string>;
  /** ScoreLabel id -> label, so a 'score_label' answer shows e.g. "Outstanding"
   *  instead of the raw id */
  scoreLabelLabels: Record<string, string>;
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
    // Escape-to-close is now Radix Dialog's own responsibility (see
    // onEscapeKeyDown below, which still respects the same `editing` guard);
    // this listener only owns the arrow-key pagination Radix doesn't provide.
    function onKey(e: KeyboardEvent) {
      if (editing) return; // don't hijack arrow keys while correcting an answer
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onPrev, onNext]);

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-2xl"
        onEscapeKeyDown={(e) => {
          if (editing) e.preventDefault(); // don't hijack escape while correcting an answer
        }}
      >
        <DialogHeader>
          <DialogTitle>
            response {index + 1} of {total}
          </DialogTitle>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {submission.submittedBy?.displayName ?? 'anonymous'} · {new Date(submission.createdAt).toLocaleString()}
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
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => setEditing(true)}>
              edit
            </Button>
          )}
        </DialogHeader>
        <div className="response-modal-body min-h-0 flex-1">
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
                <Alert variant="destructive">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadFile(`/v1/forms/${slug}/uploads/${value}`, field.label)}
                        >
                          download attachment
                        </Button>
                      ) : field.type === 'file' && Array.isArray(value) && value.length > 0 ? (
                        <span className="builder-field-actions">
                          {value.map((uploadId, i) => (
                            <Button
                              key={uploadId}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                downloadFile(`/v1/forms/${slug}/uploads/${uploadId}`, `${field.label}-${i + 1}`)
                              }
                            >
                              download {i + 1}
                            </Button>
                          ))}
                        </span>
                      ) : (
                        formatAnswer(value, field, personNames, performanceLevelLabels, scoreLabelLabels)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        <DialogFooter>
          {editing ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(submission.answers);
                  setSaveError(null);
                }}
              >
                cancel
              </Button>
              <Button disabled={saving} onClick={onSave}>
                {saving ? 'saving…' : 'save'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onPrev?.()} disabled={!onPrev}>
                ← previous
              </Button>
              <Button variant="ghost" onClick={() => onNext?.()} disabled={!onNext}>
                next →
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
