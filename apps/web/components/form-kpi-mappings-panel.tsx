'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  BulkCreateFormKpiMappingResult,
  FormDefinition,
  FormKpiMappingWithArea,
  KpiOptionSummary,
  ReviewType,
} from '@pulse/contracts';
import { REVIEW_TYPES } from '@pulse/contracts';
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

/** The Forms→KPI bridge: which of this form's own fields supplies the
 *  score, mapped to a KPI Evaluation Area. Every future submission upserts a
 *  scored entry — for the submitter themselves (self-assessment). */
export function FormKpiMappingsPanel({ formId, definition }: { formId: string; definition: FormDefinition }) {
  const [mappings, setMappings] = useState<MappingRow[] | null>(null);
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [kpiId, setKpiId] = useState('');
  const [evaluationAreaId, setEvaluationAreaId] = useState('');
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
  const [bulkReviewType, setBulkReviewType] = useState<ReviewType>('peer');
  const [bulkAnonymous, setBulkAnonymous] = useState(false);
  const [bulkContextFieldKey, setBulkContextFieldKey] = useState('');
  const [bulkCommentFieldKey, setBulkCommentFieldKey] = useState('');
  const [bulkSelections, setBulkSelections] = useState<Record<string, string>>({});
  const [bulkResult, setBulkResult] = useState<BulkMappingResult | null>(null);

  const scoreFields = definition.fields.filter((f) => f.type === 'rating' || f.type === 'nps' || f.type === 'slider');

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
    if (!evaluationAreaId || !scoreFieldKey) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/kpi-mappings`, {
        method: 'POST',
        body: JSON.stringify({
          evaluationAreaId,
          scoreFieldKey,
          reviewType,
          anonymous,
          ...(contextFieldKey ? { contextFieldKey } : {}),
          ...(commentFieldKey ? { commentFieldKey } : {}),
        }),
      });
      setKpiId('');
      setEvaluationAreaId('');
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
          connect this survey to a KPI Evaluation Area: pick which field supplies the score. Every future submission
          upserts a self-assessment entry for the submitter and period automatically.
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
          <p className="muted">add a rating, NPS, or slider field to this form to supply the score.</p>
        ) : (
          <>
            <label>current mappings</label>
            {mappings === null ? (
              <LoadingState />
            ) : mappings.length === 0 ? (
              <p className="muted">no KPI mapping yet — add one below.</p>
            ) : (
              <ul className="summary-samples">
                {mappings.map((m) => (
                  <li key={m.id}>
                    <strong>{m.evaluationArea.name}</strong> ({m.evaluationArea.cadence}) —{' '}
                    {REVIEW_TYPE_LABEL[m.reviewType]}
                    {m.anonymous && ' · anonymous'} · evaluatee:{' '}
                    {m.evaluateeFieldKey ? fieldLabel(m.evaluateeFieldKey) : 'self'}, score:{' '}
                    {fieldLabel(m.scoreFieldKey)}{' '}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={backfillingId === m.id}
                      onClick={() => onBackfill(m.id, m.evaluationArea.name)}
                      title="score every existing submission against this mapping too"
                    >
                      {backfillingId === m.id ? 'scoring…' : 'backfill existing responses'}
                    </Button>{' '}
                    {confirmDeleteId === m.id ? (
                      <>
                        <span className="muted">remove this mapping?</span>{' '}
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onDelete(m.id)}>
                          confirm remove
                        </Button>{' '}
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                          cancel
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
                        remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="kpi-mapping-kpi">add a mapping</label>
            <Select
              value={kpiId}
              onValueChange={(v) => {
                setKpiId(v);
                setEvaluationAreaId('');
              }}
            >
              <SelectTrigger id="kpi-mapping-kpi">
                <SelectValue placeholder="choose a KPI…" />
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
              <SelectTrigger aria-label="evaluation area">
                <SelectValue placeholder="choose an evaluation area…" />
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
              <SelectTrigger aria-label="score field">
                <SelectValue placeholder="which field supplies the score…" />
              </SelectTrigger>
              <SelectContent>
                {scoreFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={reviewType} onValueChange={(v) => setReviewType(v as ReviewType)}>
              <SelectTrigger aria-label="review type">
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
              keep the evaluator anonymous
            </label>
            <Select value={contextFieldKey || NONE} onValueChange={(v) => setContextFieldKey(v === NONE ? '' : v)}>
              <SelectTrigger aria-label="context field (optional)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>no context field</SelectItem>
                {definition.fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    context: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={commentFieldKey || NONE} onValueChange={(v) => setCommentFieldKey(v === NONE ? '' : v)}>
              <SelectTrigger aria-label="comment field (optional)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>no comment field</SelectItem>
                {definition.fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    comment: {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !evaluationAreaId || !scoreFieldKey}
              onClick={onCreate}
            >
              add mapping
            </Button>

            {unmappedScoreFields.length >= 2 && (
              <div className="kpi-bulk-mapping">
                {bulkResult && (
                  <Alert>
                    <AlertDescription>
                      mapped {bulkResult.created.length} question{bulkResult.created.length === 1 ? '' : 's'}
                      {bulkResult.skipped.length > 0 &&
                        ` · skipped ${bulkResult.skipped.length}: ${bulkResult.skipped
                          .map((s) => `${areaName(s.evaluationAreaId)} (${s.reason})`)
                          .join('; ')}`}
                    </AlertDescription>
                  </Alert>
                )}
                {bulkOpen ? (
                  <>
                    <label>
                      bulk-map the {unmappedScoreFields.length} remaining unmapped question
                      {unmappedScoreFields.length === 1 ? '' : 's'}
                    </label>
                    <Select value={bulkReviewType} onValueChange={(v) => setBulkReviewType(v as ReviewType)}>
                      <SelectTrigger aria-label="review type for this batch">
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
                      <Checkbox
                        checked={bulkAnonymous}
                        onCheckedChange={(checked) => setBulkAnonymous(checked === true)}
                      />
                      keep evaluators anonymous
                    </label>
                    <Select
                      value={bulkContextFieldKey || NONE}
                      onValueChange={(v) => setBulkContextFieldKey(v === NONE ? '' : v)}
                    >
                      <SelectTrigger aria-label="context field for this batch (optional)">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>no context field</SelectItem>
                        {definition.fields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            context: {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={bulkCommentFieldKey || NONE}
                      onValueChange={(v) => setBulkCommentFieldKey(v === NONE ? '' : v)}
                    >
                      <SelectTrigger aria-label="comment field for this batch (optional)">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>no comment field</SelectItem>
                        {definition.fields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            comment: {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Table className="kpi-bulk-mapping-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>question</TableHead>
                          <TableHead>evaluation area</TableHead>
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
                                <SelectTrigger aria-label={`evaluation area for ${f.label}`}>
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
                        map {bulkMappedCount} question{bulkMappedCount === 1 ? '' : 's'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setBulkOpen(false)}>
                        close
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
                    bulk-map {unmappedScoreFields.length} remaining questions
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
