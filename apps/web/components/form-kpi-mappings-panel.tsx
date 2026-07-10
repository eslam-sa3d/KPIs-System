'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormDefinition, ReviewType } from '@pulse/contracts';
import { REVIEW_TYPES } from '@pulse/contracts';
import { api } from '../lib/api-client';

interface EvaluationAreaOption {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
}

interface KpiOption {
  id: string;
  name: string;
  evaluationAreas: EvaluationAreaOption[];
}

interface MappingRow {
  id: string;
  evaluationAreaId: string;
  evaluateeFieldKey: string;
  scoreFieldKey: string;
  reviewType: ReviewType;
  anonymous: boolean;
  contextFieldKey: string | null;
  commentFieldKey: string | null;
  evaluationArea: { id: string; name: string; kpiId: string; cadence: string };
}

interface BulkMappingResult {
  created: MappingRow[];
  skipped: Array<{ evaluationAreaId: string; reason: string }>;
}

const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  self: 'self-assessment',
  peer: 'peer review',
  manager: 'manager review',
  '360': '360 review',
};

/** Lowercase, strip everything but letters/digits to single spaces — a field
 *  label and an Evaluation Area name only need to agree on their words, not
 *  punctuation or case, to count as a match. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Best-guess Evaluation Area for a question label: exact match, then
 *  substring either direction, then word overlap — a real evaluation form's
 *  question labels are usually the competency name itself (e.g. "Test Case
 *  Design Quality"), so this catches the large majority of a big form's
 *  questions without the admin picking each one by hand. Returns null below
 *  a confidence floor rather than guessing at a wrong area. */
function suggestAreaFor(fieldLabel: string, areas: Array<{ id: string; name: string }>): string {
  const normField = normalize(fieldLabel);
  if (!normField) return '';
  let bestId = '';
  let bestScore = 0;
  for (const area of areas) {
    const normArea = normalize(area.name);
    if (!normArea) continue;
    let score = 0;
    if (normField === normArea) {
      score = 100;
    } else if (normField.includes(normArea) || normArea.includes(normField)) {
      score = 60;
    } else {
      const fieldWords = new Set(normField.split(' '));
      const areaWords = normArea.split(' ');
      const overlap = areaWords.filter((w) => fieldWords.has(w)).length;
      score = areaWords.length > 0 ? (overlap / areaWords.length) * 50 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = area.id;
    }
  }
  return bestScore >= 30 ? bestId : '';
}

/** The Forms→KPI bridge: which of this form's own fields names the evaluatee
 *  vs. supplies the score, mapped to a KPI Evaluation Area. Every future
 *  submission upserts a scored entry for that person and period. */
export function FormKpiMappingsPanel({ formId, definition }: { formId: string; definition: FormDefinition }) {
  const [mappings, setMappings] = useState<MappingRow[] | null>(null);
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [kpiId, setKpiId] = useState('');
  const [evaluationAreaId, setEvaluationAreaId] = useState('');
  const [evaluateeFieldKey, setEvaluateeFieldKey] = useState('');
  const [scoreFieldKey, setScoreFieldKey] = useState('');
  const [reviewType, setReviewType] = useState<ReviewType>('peer');
  const [anonymous, setAnonymous] = useState(false);
  const [contextFieldKey, setContextFieldKey] = useState('');
  const [commentFieldKey, setCommentFieldKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEvaluateeFieldKey, setBulkEvaluateeFieldKey] = useState('');
  const [bulkReviewType, setBulkReviewType] = useState<ReviewType>('peer');
  const [bulkAnonymous, setBulkAnonymous] = useState(false);
  const [bulkContextFieldKey, setBulkContextFieldKey] = useState('');
  const [bulkCommentFieldKey, setBulkCommentFieldKey] = useState('');
  const [bulkSelections, setBulkSelections] = useState<Record<string, string>>({});
  const [bulkResult, setBulkResult] = useState<BulkMappingResult | null>(null);

  const personFields = definition.fields.filter((f) => f.type === 'person');
  const scoreFields = definition.fields.filter(
    (f) => f.type === 'rating' || f.type === 'nps' || f.type === 'slider',
  );

  function reload() {
    api<MappingRow[]>(`/v1/forms/${formId}/kpi-mappings`).then(setMappings).catch(() => setMappings([]));
    api<KpiOption[]>('/v1/kpis?pageSize=100').then(setKpis).catch(() => setKpis([]));
  }

  useEffect(reload, [formId]);

  const kpiAreas = kpis?.find((k) => k.id === kpiId)?.evaluationAreas.filter((a) => a.isActive) ?? [];

  const allAreas = useMemo(
    () => (kpis ?? []).flatMap((k) => k.evaluationAreas.filter((a) => a.isActive).map((a) => ({ ...a, kpiName: k.name }))),
    [kpis],
  );

  const unmappedScoreFields = useMemo(
    () => scoreFields.filter((f) => !mappings?.some((m) => m.scoreFieldKey === f.key)),
    [scoreFields, mappings],
  );

  function fieldLabel(key: string) {
    return definition.fields.find((f) => f.key === key)?.label ?? key;
  }

  function areaName(id: string) {
    return allAreas.find((a) => a.id === id)?.name ?? id;
  }

  async function onCreate() {
    if (!evaluationAreaId || !evaluateeFieldKey || !scoreFieldKey) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/kpi-mappings`, {
        method: 'POST',
        body: JSON.stringify({
          evaluationAreaId,
          evaluateeFieldKey,
          scoreFieldKey,
          reviewType,
          anonymous,
          ...(contextFieldKey ? { contextFieldKey } : {}),
          ...(commentFieldKey ? { commentFieldKey } : {}),
        }),
      });
      setKpiId('');
      setEvaluationAreaId('');
      setEvaluateeFieldKey('');
      setScoreFieldKey('');
      setReviewType('peer');
      setAnonymous(false);
      setContextFieldKey('');
      setCommentFieldKey('');
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(mappingId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/kpi-mappings/${mappingId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onBackfill(mappingId: string, areaLabel: string) {
    setBackfillingId(mappingId);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ scored: number; skipped: number }>(
        `/v1/forms/${formId}/kpi-mappings/${mappingId}/backfill`,
        { method: 'POST' },
      );
      setNotice(
        `scored ${result.scored} existing submission${result.scored === 1 ? '' : 's'} into "${areaLabel}"` +
          (result.skipped > 0 ? ` · skipped ${result.skipped}` : ''),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBackfillingId(null);
    }
  }

  function openBulk() {
    setBulkOpen(true);
    setBulkResult(null);
    if (!bulkEvaluateeFieldKey && personFields.length > 0) setBulkEvaluateeFieldKey(personFields[0]!.key);
    setBulkSelections((current) => {
      const next = { ...current };
      for (const f of unmappedScoreFields) {
        if (next[f.key] === undefined) next[f.key] = suggestAreaFor(f.label, allAreas);
      }
      return next;
    });
  }

  const bulkMappedCount = unmappedScoreFields.filter((f) => bulkSelections[f.key]).length;

  async function onBulkCreate() {
    if (!bulkEvaluateeFieldKey || bulkMappedCount === 0) return;
    setBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const result = await api<BulkMappingResult>(`/v1/forms/${formId}/kpi-mappings/bulk`, {
        method: 'POST',
        body: JSON.stringify({
          evaluateeFieldKey: bulkEvaluateeFieldKey,
          reviewType: bulkReviewType,
          anonymous: bulkAnonymous,
          ...(bulkContextFieldKey ? { contextFieldKey: bulkContextFieldKey } : {}),
          ...(bulkCommentFieldKey ? { commentFieldKey: bulkCommentFieldKey } : {}),
          mappings: unmappedScoreFields
            .filter((f) => bulkSelections[f.key])
            .map((f) => ({ scoreFieldKey: f.key, evaluationAreaId: bulkSelections[f.key]! })),
        }),
      });
      setBulkResult(result);
      setBulkSelections({});
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <h2>KPI scoring</h2>
      <p className="muted">
        connect this survey to a KPI Evaluation Area: pick which field names the person being
        evaluated and which field supplies the score. Every future submission upserts a scored
        entry for that person and period automatically.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      {personFields.length === 0 ? (
        <p className="muted">add a &quot;person&quot; field to this form (the evaluatee) to enable KPI scoring.</p>
      ) : scoreFields.length === 0 ? (
        <p className="muted">add a rating, NPS, or slider field to this form to supply the score.</p>
      ) : (
        <>
          <label>current mappings</label>
          {mappings === null ? (
            <p className="muted">loading…</p>
          ) : mappings.length === 0 ? (
            <p className="muted">no KPI mapping yet — add one below.</p>
          ) : (
            <ul className="summary-samples">
              {mappings.map((m) => (
                <li key={m.id}>
                  <strong>{m.evaluationArea.name}</strong> ({m.evaluationArea.cadence}) —{' '}
                  {REVIEW_TYPE_LABEL[m.reviewType]}
                  {m.anonymous && ' · anonymous'} · evaluatee: {fieldLabel(m.evaluateeFieldKey)}, score:{' '}
                  {fieldLabel(m.scoreFieldKey)}{' '}
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={backfillingId === m.id}
                    onClick={() => onBackfill(m.id, m.evaluationArea.name)}
                    title="score every existing submission against this mapping too"
                  >
                    {backfillingId === m.id ? 'scoring…' : 'backfill existing responses'}
                  </button>{' '}
                  {confirmDeleteId === m.id ? (
                    <>
                      <span className="muted">remove this mapping?</span>{' '}
                      <button type="button" className="btn-ghost" disabled={busy} onClick={() => onDelete(m.id)}>
                        confirm remove
                      </button>{' '}
                      <button type="button" className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => setConfirmDeleteId(m.id)}
                    >
                      remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <label htmlFor="kpi-mapping-kpi">add a mapping</label>
          <select
            id="kpi-mapping-kpi"
            value={kpiId}
            onChange={(e) => {
              setKpiId(e.target.value);
              setEvaluationAreaId('');
            }}
          >
            <option value="">choose a KPI…</option>
            {kpis?.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <select
            aria-label="evaluation area"
            value={evaluationAreaId}
            onChange={(e) => setEvaluationAreaId(e.target.value)}
            disabled={!kpiId}
          >
            <option value="">choose an evaluation area…</option>
            {kpiAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="evaluatee field"
            value={evaluateeFieldKey}
            onChange={(e) => setEvaluateeFieldKey(e.target.value)}
          >
            <option value="">which field names who is being evaluated…</option>
            {personFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select aria-label="score field" value={scoreFieldKey} onChange={(e) => setScoreFieldKey(e.target.value)}>
            <option value="">which field supplies the score…</option>
            {scoreFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label="review type"
            value={reviewType}
            onChange={(e) => setReviewType(e.target.value as ReviewType)}
          >
            {REVIEW_TYPES.map((t) => (
              <option key={t} value={t}>
                {REVIEW_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="check-item">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            keep the evaluator anonymous
          </label>
          <select
            aria-label="context field (optional)"
            value={contextFieldKey}
            onChange={(e) => setContextFieldKey(e.target.value)}
          >
            <option value="">no context field</option>
            {definition.fields.map((f) => (
              <option key={f.key} value={f.key}>
                context: {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label="comment field (optional)"
            value={commentFieldKey}
            onChange={(e) => setCommentFieldKey(e.target.value)}
          >
            <option value="">no comment field</option>
            {definition.fields.map((f) => (
              <option key={f.key} value={f.key}>
                comment: {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !evaluationAreaId || !evaluateeFieldKey || !scoreFieldKey}
            onClick={onCreate}
          >
            add mapping
          </button>

          {unmappedScoreFields.length >= 2 && (
            <div className="kpi-bulk-mapping">
              {bulkResult && (
                <p className="form-notice">
                  mapped {bulkResult.created.length} question{bulkResult.created.length === 1 ? '' : 's'}
                  {bulkResult.skipped.length > 0 &&
                    ` · skipped ${bulkResult.skipped.length}: ${bulkResult.skipped
                      .map((s) => `${areaName(s.evaluationAreaId)} (${s.reason})`)
                      .join('; ')}`}
                </p>
              )}
              {bulkOpen ? (
                <>
                  <label htmlFor="kpi-bulk-evaluatee">
                    bulk-map the {unmappedScoreFields.length} remaining unmapped question
                    {unmappedScoreFields.length === 1 ? '' : 's'} — evaluatee field
                  </label>
                  <select
                    id="kpi-bulk-evaluatee"
                    value={bulkEvaluateeFieldKey}
                    onChange={(e) => setBulkEvaluateeFieldKey(e.target.value)}
                  >
                    {personFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="review type for this batch"
                    value={bulkReviewType}
                    onChange={(e) => setBulkReviewType(e.target.value as ReviewType)}
                  >
                    {REVIEW_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {REVIEW_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <label className="check-item">
                    <input
                      type="checkbox"
                      checked={bulkAnonymous}
                      onChange={(e) => setBulkAnonymous(e.target.checked)}
                    />
                    keep evaluators anonymous
                  </label>
                  <select
                    aria-label="context field for this batch (optional)"
                    value={bulkContextFieldKey}
                    onChange={(e) => setBulkContextFieldKey(e.target.value)}
                  >
                    <option value="">no context field</option>
                    {definition.fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        context: {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="comment field for this batch (optional)"
                    value={bulkCommentFieldKey}
                    onChange={(e) => setBulkCommentFieldKey(e.target.value)}
                  >
                    <option value="">no comment field</option>
                    {definition.fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        comment: {f.label}
                      </option>
                    ))}
                  </select>

                  <table className="data-table kpi-bulk-mapping-table">
                    <thead>
                      <tr>
                        <th>question</th>
                        <th>evaluation area</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmappedScoreFields.map((f) => (
                        <tr key={f.key}>
                          <td>{f.label}</td>
                          <td>
                            <select
                              aria-label={`evaluation area for ${f.label}`}
                              value={bulkSelections[f.key] ?? ''}
                              onChange={(e) =>
                                setBulkSelections((current) => ({ ...current, [f.key]: e.target.value }))
                              }
                            >
                              <option value="">— don&apos;t map —</option>
                              {kpis?.map((k) => (
                                <optgroup key={k.id} label={k.name}>
                                  {k.evaluationAreas
                                    .filter((a) => a.isActive)
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy || !bulkEvaluateeFieldKey || bulkMappedCount === 0}
                      onClick={onBulkCreate}
                    >
                      map {bulkMappedCount} question{bulkMappedCount === 1 ? '' : 's'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setBulkOpen(false)}>
                      close
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="add-trigger" onClick={openBulk}>
                  bulk-map {unmappedScoreFields.length} remaining questions
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
