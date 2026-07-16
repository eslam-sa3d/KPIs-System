'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  BulkCreateFormKpiMappingResult,
  FormDefinition,
  FormKpiMappingWithArea,
  KpiOptionSummary,
  ReviewType,
} from '@pulse/contracts';
import { isEvaluateeField, REVIEW_TYPES } from '@pulse/contracts';
import { api } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/loading-state';

/** Radix Select forbids an empty-string item value, so the "clear this
 *  optional field" choice needs a real sentinel we translate at the edges. */
const NONE = '__none__';

type KpiOption = KpiOptionSummary;
type MappingRow = FormKpiMappingWithArea;
type BulkMappingResult = BulkCreateFormKpiMappingResult;

const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  self: 'Self-assessment',
  peer: 'Peer review',
  manager: 'Manager review',
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

/** The Forms→KPI bridge: which of this form's own fields supplies the
 *  score, mapped to a KPI Evaluation Area. Every future submission upserts a
 *  scored entry — for the submitter themselves (self-assessment). */
export function FormKpiMappingsPanel({ formId, definition }: { formId: string; definition: FormDefinition }) {
  const [mappings, setMappings] = useState<MappingRow[] | null>(null);
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [kpiId, setKpiId] = useState('');
  const [evaluationAreaId, setEvaluationAreaId] = useState('');
  const [scoreFieldKey, setScoreFieldKey] = useState('');
  const [evaluateeFieldKeys, setEvaluateeFieldKeys] = useState<Set<string>>(new Set());
  const [reviewType, setReviewType] = useState<ReviewType>('peer');
  const [anonymous, setAnonymous] = useState(false);
  const [contextFieldKey, setContextFieldKey] = useState('');
  const [commentFieldKey, setCommentFieldKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  // Set while the "add a mapping" form below is editing an existing row
  // instead of creating a new one — same fields, PATCH instead of POST.
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEvaluateeFieldKeys, setBulkEvaluateeFieldKeys] = useState<Set<string>>(new Set());
  const [bulkReviewType, setBulkReviewType] = useState<ReviewType>('peer');
  const [bulkAnonymous, setBulkAnonymous] = useState(false);
  const [bulkContextFieldKey, setBulkContextFieldKey] = useState('');
  const [bulkCommentFieldKey, setBulkCommentFieldKey] = useState('');
  const [bulkSelections, setBulkSelections] = useState<Record<string, string>>({});
  const [bulkResult, setBulkResult] = useState<BulkMappingResult | null>(null);

  const scoreFields = definition.fields.filter(
    (f) => f.type === 'rating' || f.type === 'nps' || f.type === 'slider' || f.type === 'performance_level',
  );
  // A 'person' field, or a 'select' field with at least one option added via
  // "select a user" in the builder — either can supply the evaluatee's id.
  const evaluateeFields = definition.fields.filter(isEvaluateeField);

  function reload() {
    api<MappingRow[]>(`/v1/forms/${formId}/kpi-mappings`)
      .then(setMappings)
      .catch(() => setMappings([]));
    api<KpiOption[]>('/v1/kpis?pageSize=100')
      .then(setKpis)
      .catch(() => setKpis([]));
  }

  useEffect(reload, [formId]);

  const kpiAreas = kpis?.find((k) => k.id === kpiId)?.evaluationAreas.filter((a) => a.isActive) ?? [];

  const allAreas = useMemo(
    () =>
      (kpis ?? []).flatMap((k) => k.evaluationAreas.filter((a) => a.isActive).map((a) => ({ ...a, kpiName: k.name }))),
    [kpis],
  );

  // Unfiltered (unlike allAreas above, deliberately active-only for mapping
  // suggestions) — areaName() needs every area, including deactivated ones,
  // since a bulk-mapping "skipped" result can reference an area that's since
  // been deactivated, and falling back to its raw id there is exactly the
  // "shows a UUID instead of a label" bug this is fixing.
  const allAreasIncludingInactive = useMemo(
    () => (kpis ?? []).flatMap((k) => k.evaluationAreas.map((a) => ({ ...a, kpiName: k.name }))),
    [kpis],
  );

  const unmappedScoreFields = useMemo(
    () => scoreFields.filter((f) => !mappings?.some((m) => m.scoreFieldKey === f.key)),
    [scoreFields, mappings],
  );

  function fieldLabel(key: string) {
    return definition.fields.find((f) => f.key === key)?.label ?? key;
  }

  function onToggleEvaluateeField(key: string) {
    setEvaluateeFieldKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onToggleBulkEvaluateeField(key: string) {
    setBulkEvaluateeFieldKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function areaName(id: string) {
    return allAreasIncludingInactive.find((a) => a.id === id)?.name ?? id;
  }

  function resetMappingForm() {
    setEditingMappingId(null);
    setKpiId('');
    setEvaluationAreaId('');
    setScoreFieldKey('');
    setEvaluateeFieldKeys(new Set());
    setReviewType('peer');
    setAnonymous(false);
    setContextFieldKey('');
    setCommentFieldKey('');
  }

  /** Pre-fills the single-mapping form (below) from an existing row and
   *  switches it into edit mode — the same fields, submitted as a PATCH
   *  instead of a POST, so fixing e.g. a missing evaluatee field no longer
   *  requires delete + recreate + backfill. */
  function onStartEdit(m: MappingRow) {
    setEditingMappingId(m.id);
    setKpiId(m.evaluationArea.kpiId);
    setEvaluationAreaId(m.evaluationAreaId);
    setScoreFieldKey(m.scoreFieldKey);
    setEvaluateeFieldKeys(new Set(m.evaluateeFieldKeys));
    setReviewType(m.reviewType);
    setAnonymous(m.anonymous);
    setContextFieldKey(m.contextFieldKey ?? '');
    setCommentFieldKey(m.commentFieldKey ?? '');
    setError(null);
  }

  async function onSaveMapping() {
    if (!evaluationAreaId || !scoreFieldKey) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        evaluationAreaId,
        scoreFieldKey,
        reviewType,
        anonymous,
        ...(evaluateeFieldKeys.size > 0 ? { evaluateeFieldKeys: [...evaluateeFieldKeys] } : {}),
        ...(contextFieldKey ? { contextFieldKey } : {}),
        ...(commentFieldKey ? { commentFieldKey } : {}),
      });
      if (editingMappingId) {
        await api(`/v1/forms/${formId}/kpi-mappings/${editingMappingId}`, { method: 'PATCH', body });
      } else {
        await api(`/v1/forms/${formId}/kpi-mappings`, { method: 'POST', body });
      }
      resetMappingForm();
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
        `Scored ${result.scored} existing submission${result.scored === 1 ? '' : 's'} into "${areaLabel}"` +
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
    if (bulkMappedCount === 0) return;
    setBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const result = await api<BulkMappingResult>(`/v1/forms/${formId}/kpi-mappings/bulk`, {
        method: 'POST',
        body: JSON.stringify({
          reviewType: bulkReviewType,
          anonymous: bulkAnonymous,
          ...(bulkEvaluateeFieldKeys.size > 0 ? { evaluateeFieldKeys: [...bulkEvaluateeFieldKeys] } : {}),
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
    <Card>
      <CardHeader>
        <CardTitle>KPI scoring</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          Connect this survey to a KPI Evaluation Area: pick which field supplies the score, and — for a peer, manager,
          or 360 review — which field says who it&apos;s about. Left as self-assessment, every future submission scores
          the submitter themselves. Every future submission upserts an entry automatically.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {scoreFields.length === 0 ? (
          <p className="muted">Add a rating, NPS, or slider field to this form to supply the score.</p>
        ) : (
          <>
            <span className="field-label">Current mappings</span>
            {mappings === null ? (
              <LoadingState />
            ) : mappings.length === 0 ? (
              <p className="muted">No KPI mapping yet — add one below.</p>
            ) : (
              <ul className="summary-samples">
                {mappings.map((m) => (
                  <li key={m.id}>
                    <strong>{m.evaluationArea.name}</strong> ({m.evaluationArea.cadence}) —{' '}
                    {REVIEW_TYPE_LABEL[m.reviewType]}
                    {m.anonymous && ' · anonymous'} · evaluatee:{' '}
                    {m.evaluateeFieldKeys.length > 0 ? m.evaluateeFieldKeys.map(fieldLabel).join(', ') : 'Self'}, score:{' '}
                    {fieldLabel(m.scoreFieldKey)}{' '}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={backfillingId === m.id}
                      onClick={() => onBackfill(m.id, m.evaluationArea.name)}
                      title="Score every existing submission against this mapping too"
                    >
                      {backfillingId === m.id ? 'Scoring…' : 'Backfill existing responses'}
                    </Button>{' '}
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onStartEdit(m)}>
                      Edit
                    </Button>{' '}
                    {confirmDeleteId === m.id ? (
                      <>
                        <span className="muted">Remove this mapping?</span>{' '}
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onDelete(m.id)}>
                          Confirm remove
                        </Button>{' '}
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(m.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="kpi-mapping-kpi">{editingMappingId ? 'Edit mapping' : 'Add a mapping'}</label>
            <Select
              value={kpiId}
              onValueChange={(v) => {
                setKpiId(v);
                setEvaluationAreaId('');
              }}
            >
              <SelectTrigger id="kpi-mapping-kpi">
                <SelectValue placeholder="Choose a KPI…" />
              </SelectTrigger>
              <SelectContent>
                {kpis?.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={evaluationAreaId} onValueChange={setEvaluationAreaId} disabled={!kpiId}>
              <SelectTrigger aria-label="Evaluation area">
                <SelectValue placeholder="Choose an evaluation area…" />
              </SelectTrigger>
              <SelectContent>
                {kpiAreas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={scoreFieldKey} onValueChange={setScoreFieldKey}>
              <SelectTrigger aria-label="Score field">
                <SelectValue placeholder="Which field supplies the score…" />
              </SelectTrigger>
              <SelectContent>
                {scoreFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="field-label">
              Who this is about — check every candidate field; whichever one is actually answered on a submission wins
              (leave all unchecked for self-assessment)
            </span>
            {evaluateeFields.length === 0 ? (
              <p className="muted">
                No eligible field on this form — add a &quot;person&quot; field, or a &quot;select&quot; field with a
                user-linked option, to enable peer/manager/360 scoring.
              </p>
            ) : (
              <span className="check-group">
                {evaluateeFields.map((f) => (
                  <label key={f.key} className="check-item">
                    <Checkbox
                      checked={evaluateeFieldKeys.has(f.key)}
                      onCheckedChange={() => onToggleEvaluateeField(f.key)}
                    />{' '}
                    {f.label}
                  </label>
                ))}
              </span>
            )}
            <Select value={reviewType} onValueChange={(v) => setReviewType(v as ReviewType)}>
              <SelectTrigger aria-label="Review type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {REVIEW_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="check-item">
              <Checkbox checked={anonymous} onCheckedChange={(checked) => setAnonymous(checked === true)} />
              Keep the evaluator anonymous
            </label>
            <Select value={contextFieldKey || NONE} onValueChange={(v) => setContextFieldKey(v === NONE ? '' : v)}>
              <SelectTrigger aria-label="Context field (optional)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No context field</SelectItem>
                {definition.fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    Context: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={commentFieldKey || NONE} onValueChange={(v) => setCommentFieldKey(v === NONE ? '' : v)}>
              <SelectTrigger aria-label="Comment field (optional)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No comment field</SelectItem>
                {definition.fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    Comment: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !evaluationAreaId || !scoreFieldKey}
              onClick={onSaveMapping}
            >
              {editingMappingId ? 'Save changes' : 'Add mapping'}
            </Button>
            {editingMappingId && (
              <Button type="button" variant="ghost" disabled={busy} onClick={resetMappingForm}>
                Cancel
              </Button>
            )}

            {unmappedScoreFields.length >= 2 && (
              <div className="kpi-bulk-mapping">
                {bulkResult && (
                  <Alert>
                    <AlertDescription>
                      Mapped {bulkResult.created.length} question{bulkResult.created.length === 1 ? '' : 's'}
                      {bulkResult.skipped.length > 0 &&
                        ` · skipped ${bulkResult.skipped.length}: ${bulkResult.skipped
                          .map((s) => `${areaName(s.evaluationAreaId)} (${s.reason})`)
                          .join('; ')}`}
                    </AlertDescription>
                  </Alert>
                )}
                {bulkOpen ? (
                  <>
                    <span className="field-label">
                      Bulk-map the {unmappedScoreFields.length} remaining unmapped question
                      {unmappedScoreFields.length === 1 ? '' : 's'}
                    </span>
                    <Select value={bulkReviewType} onValueChange={(v) => setBulkReviewType(v as ReviewType)}>
                      <SelectTrigger aria-label="Review type for this batch">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REVIEW_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {REVIEW_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="field-label">
                      Who this batch is about — check every candidate field; whichever one is actually answered on a
                      submission wins (leave all unchecked for self-assessment)
                    </span>
                    {evaluateeFields.length === 0 ? (
                      <p className="muted">No eligible field on this form.</p>
                    ) : (
                      <span className="check-group">
                        {evaluateeFields.map((f) => (
                          <label key={f.key} className="check-item">
                            <Checkbox
                              checked={bulkEvaluateeFieldKeys.has(f.key)}
                              onCheckedChange={() => onToggleBulkEvaluateeField(f.key)}
                            />{' '}
                            {f.label}
                          </label>
                        ))}
                      </span>
                    )}
                    <label className="check-item">
                      <Checkbox
                        checked={bulkAnonymous}
                        onCheckedChange={(checked) => setBulkAnonymous(checked === true)}
                      />
                      Keep evaluators anonymous
                    </label>
                    <Select
                      value={bulkContextFieldKey || NONE}
                      onValueChange={(v) => setBulkContextFieldKey(v === NONE ? '' : v)}
                    >
                      <SelectTrigger aria-label="Context field for this batch (optional)">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No context field</SelectItem>
                        {definition.fields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            Context: {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={bulkCommentFieldKey || NONE}
                      onValueChange={(v) => setBulkCommentFieldKey(v === NONE ? '' : v)}
                    >
                      <SelectTrigger aria-label="Comment field for this batch (optional)">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No comment field</SelectItem>
                        {definition.fields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            Comment: {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Table className="kpi-bulk-mapping-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Question</TableHead>
                          <TableHead>Evaluation area</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unmappedScoreFields.map((f) => (
                          <TableRow key={f.key}>
                            <TableCell>{f.label}</TableCell>
                            <TableCell>
                              <Select
                                value={bulkSelections[f.key] || NONE}
                                onValueChange={(v) =>
                                  setBulkSelections((current) => ({ ...current, [f.key]: v === NONE ? '' : v }))
                                }
                              >
                                <SelectTrigger aria-label={`Evaluation area for ${f.label}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>— don&apos;t map —</SelectItem>
                                  {kpis?.map((k) => (
                                    <SelectGroup key={k.id}>
                                      <SelectLabel>{k.name}</SelectLabel>
                                      {k.evaluationAreas
                                        .filter((a) => a.isActive)
                                        .map((a) => (
                                          <SelectItem key={a.id} value={a.id}>
                                            {a.name}
                                          </SelectItem>
                                        ))}
                                    </SelectGroup>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="row-actions">
                      <Button type="button" size="sm" disabled={busy || bulkMappedCount === 0} onClick={onBulkCreate}>
                        Map {bulkMappedCount} question{bulkMappedCount === 1 ? '' : 's'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setBulkOpen(false)}>
                        Close
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                    onClick={openBulk}
                  >
                    Bulk-map {unmappedScoreFields.length} remaining questions
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
