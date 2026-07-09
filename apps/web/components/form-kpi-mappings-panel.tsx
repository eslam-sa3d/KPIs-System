'use client';

import { useEffect, useState } from 'react';
import type { FormDefinition } from '@pulse/contracts';
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
  evaluationArea: { id: string; name: string; kpiId: string; cadence: string };
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  function fieldLabel(key: string) {
    return definition.fields.find((f) => f.key === key)?.label ?? key;
  }

  async function onCreate() {
    if (!evaluationAreaId || !evaluateeFieldKey || !scoreFieldKey) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/kpi-mappings`, {
        method: 'POST',
        body: JSON.stringify({ evaluationAreaId, evaluateeFieldKey, scoreFieldKey }),
      });
      setKpiId('');
      setEvaluationAreaId('');
      setEvaluateeFieldKey('');
      setScoreFieldKey('');
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

  return (
    <div className="admin-card">
      <h2>KPI scoring</h2>
      <p className="muted">
        connect this survey to a KPI Evaluation Area: pick which field names the person being
        evaluated and which field supplies the score. Every future submission upserts a scored
        entry for that person and period automatically — existing submissions are unaffected.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

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
                  <strong>{m.evaluationArea.name}</strong> ({m.evaluationArea.cadence}) — evaluatee:{' '}
                  {fieldLabel(m.evaluateeFieldKey)}, score: {fieldLabel(m.scoreFieldKey)}{' '}
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
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !evaluationAreaId || !evaluateeFieldKey || !scoreFieldKey}
            onClick={onCreate}
          >
            add mapping
          </button>
        </>
      )}
    </div>
  );
}
