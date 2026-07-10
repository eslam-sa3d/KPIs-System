'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ClipboardList, Pencil } from 'lucide-react';
import type { FormDefinition, FormSettings, SubmissionAnswers } from '@pulse/contracts';
import { PortalShell, can } from '../../../components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormRenderer, SubmissionScore } from '../../../components/form-renderer';
import { FormSettingsPanel } from '../../../components/form-settings-panel';
import { ShareLinkPanel } from '../../../components/share-link-panel';
import { AccessControlPanel } from '../../../components/access-control-panel';
import { FormKpiMappingsPanel } from '../../../components/form-kpi-mappings-panel';
import { ResponseSummary, ResponseSummaryData } from '../../../components/response-summary';
import { ResponseDetailModal } from '../../../components/response-detail-modal';
import { api, downloadFile } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface FormDetail {
  form: {
    id: string;
    slug: string;
    status: string;
    publicToken: string | null;
    exportToken: string | null;
    restricted: boolean;
  };
  version: { id: string; version: number };
  definition: FormDefinition;
  settings: FormSettings;
}

interface SubmissionRow {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string } | null;
  score?: SubmissionScore | null;
}

type Tab = 'form' | 'submissions' | 'summary' | 'settings';

function FormView() {
  const user = useSession();
  const router = useRouter();
  const slug = useSearchParams().get('slug') ?? '';
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [tab, setTab] = useState<Tab>('form');
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [summary, setSummary] = useState<ResponseSummaryData | null>(null);
  const [filter, setFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState<{ key: string; label: string; value: string } | null>(null);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const reloadDetail = useCallback(() => {
    if (slug) void api<FormDetail>(`/v1/forms/${encodeURIComponent(slug)}`).then(setDetail);
  }, [slug]);

  useEffect(() => {
    if (user) reloadDetail();
  }, [user, reloadDetail]);

  const loadSubmissions = useCallback(() => {
    const qs = fieldFilter
      ? `&answers.${encodeURIComponent(fieldFilter.key)}=${encodeURIComponent(fieldFilter.value)}`
      : '';
    void api<SubmissionRow[]>(`/v1/forms/${encodeURIComponent(slug)}/submissions?pageSize=100${qs}`).then(setRows);
  }, [slug, fieldFilter]);

  const loadSummary = useCallback(() => {
    void api<ResponseSummaryData>(`/v1/forms/${encodeURIComponent(slug)}/submissions/summary`).then(setSummary);
  }, [slug]);

  useEffect(() => {
    if (!user || !slug) return;
    if (tab === 'submissions') loadSubmissions();
    if (tab === 'summary') loadSummary();
  }, [user, slug, tab, loadSubmissions, loadSummary]);

  // live-ish refresh: re-poll the active tab every 15s while the browser tab is visible,
  // so new responses show up without a manual reload — no websockets needed at this scale
  useEffect(() => {
    if (!user || !slug || (tab !== 'submissions' && tab !== 'summary')) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (tab === 'submissions') loadSubmissions();
      if (tab === 'summary') loadSummary();
    }, 15_000);
    return () => clearInterval(interval);
  }, [user, slug, tab, loadSubmissions, loadSummary]);

  function onFilterByAnswer(fieldKey: string, label: string, value: string) {
    setFieldFilter({ key: fieldKey, label, value });
    setTab('submissions');
  }

  async function onSubmit(answers: SubmissionAnswers) {
    return api<{ score?: SubmissionScore | null }>(`/v1/forms/${encodeURIComponent(slug)}/submissions`, {
      method: 'POST',
      body: JSON.stringify(answers),
    });
  }

  async function onDelete(submissionId: string) {
    await api(`/v1/forms/${slug}/submissions/${submissionId}`, { method: 'DELETE' });
    setRows((current) => (current ? current.filter((r) => r.id !== submissionId) : current));
    setConfirmDeleteRowId(null);
    setNotice('submission deleted');
    setTimeout(() => setNotice(null), 3000);
  }

  async function onDeleteAll() {
    const result = await api<{ deleted: number }>(`/v1/forms/${slug}/submissions`, { method: 'DELETE' });
    setRows([]);
    setConfirmDeleteAll(false);
    setNotice(`${result.deleted} response${result.deleted === 1 ? '' : 's'} deleted`);
    setTimeout(() => setNotice(null), 3000);
  }

  async function onDuplicate() {
    if (!detail) return;
    const copy = await api<{ slug: string }>(`/v1/forms/${detail.form.id}/duplicate`, { method: 'POST' });
    router.push(`/forms/view/?slug=${encodeURIComponent(copy.slug)}`);
  }

  if (!detail) {
    return (
      <PortalShell user={user}>
        <LoadingState />
      </PortalShell>
    );
  }

  const { definition, settings, form } = detail;
  const filteredRows = (rows ?? []).filter((row) => {
    if (dateFrom && row.createdAt < dateFrom) return false;
    if (dateTo && row.createdAt > `${dateTo}T23:59:59.999Z`) return false;
    if (!filter) return true;
    const haystack = [
      row.submittedBy?.displayName ?? 'anonymous',
      row.submittedBy?.email ?? '',
      ...Object.values(row.answers).map((v) =>
        typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
      ),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  const canManage = can(user, 'forms:write');
  const canModerate = can(user, 'form_submissions:manage');

  return (
    <PortalShell user={user}>
      <div className="page-title-row">
        <div className="hierarchy-title-row">
          <span className="hierarchy-icon hierarchy-icon-lg">
            <ClipboardList size={18} aria-hidden="true" />
          </span>
          <h1>{definition.title}</h1>
          <StatusBadge active={settings.acceptingResponses} label={settings.acceptingResponses ? 'open' : 'closed'} />
        </div>
        {canManage && (
          <span className="row-actions">
            <Button asChild variant="ghost" size="sm" className="text-primary hover:text-primary">
              <Link href={`/forms/new?edit=${encodeURIComponent(slug)}`}>
                <Pencil size={13} aria-hidden="true" />
                edit form
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={onDuplicate}>
              duplicate form
            </Button>
          </span>
        )}
      </div>
      {definition.description && <p className="portal-subtitle">{definition.description}</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList variant="line" aria-label="form views">
        <TabsTrigger value="form">form</TabsTrigger>
        <TabsTrigger value="submissions">submissions</TabsTrigger>
        <TabsTrigger value="summary">summary</TabsTrigger>
        {canManage && <TabsTrigger value="settings">settings</TabsTrigger>}
      </TabsList>

      <TabsContent value="form">
        <FormRenderer
          definition={definition}
          settings={settings}
          onSubmit={onSubmit}
          uploadPath={`/v1/forms/${encodeURIComponent(slug)}/uploads`}
        />
      </TabsContent>

      <TabsContent value="submissions">
        <section aria-label="submissions">
          {fieldFilter && (
            <Alert>
              <AlertDescription>
                filtered by {fieldFilter.label}: <strong>{fieldFilter.value}</strong>{' '}
                <Button variant="ghost" size="sm" onClick={() => setFieldFilter(null)}>
                  clear
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="page-title-row">
            <Input
              aria-label="filter submissions"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="builder-required">
              <label htmlFor="submissions-date-from" className="muted" style={{ fontSize: 12 }}>
                from
              </label>
              <Input
                id="submissions-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <label htmlFor="submissions-date-to" className="muted" style={{ fontSize: 12 }}>
                to
              </label>
              <Input id="submissions-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadFile(`/v1/forms/${slug}/submissions/export`, `${slug}.csv`)}
            >
              export CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadFile(`/v1/forms/${slug}/submissions/export.xlsx`, `${slug}.xlsx`)}
            >
              export xlsx
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadFile(`/v1/forms/${slug}/submissions/export.pdf`, `${slug}-summary.pdf`)}
            >
              export PDF
            </Button>
            {canModerate &&
              (rows?.length ?? 0) > 0 &&
              (confirmDeleteAll ? (
                <>
                  <span className="muted">delete all {rows?.length ?? 0} responses?</span>
                  <Button variant="ghost" size="sm" onClick={onDeleteAll}>
                    confirm delete all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAll(false)}>
                    cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAll(true)}>
                  delete all responses
                </Button>
              ))}
          </div>
          {notice && (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {rows === null ? (
            <LoadingState />
          ) : filteredRows.length === 0 ? (
            <p className="muted">no submissions{filter ? ' match the filter' : ' yet'}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>submitted</TableHead>
                  <TableHead>by</TableHead>
                  {definition.fields.map((f) => (
                    <TableHead key={f.key}>{f.label}</TableHead>
                  ))}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{row.submittedBy?.displayName ?? 'anonymous'}</TableCell>
                    {definition.fields.map((f) => {
                      const value = row.answers[f.key];
                      return (
                        <TableCell key={f.key}>
                          {f.type === 'file' && typeof value === 'string' && value ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => downloadFile(`/v1/forms/${slug}/uploads/${value}`, f.label)}
                            >
                              download
                            </Button>
                          ) : f.type === 'file' && Array.isArray(value) && value.length > 0 ? (
                            <span className="builder-field-actions">
                              {value.map((uploadId, i) => (
                                <Button
                                  key={uploadId}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => downloadFile(`/v1/forms/${slug}/uploads/${uploadId}`, `${f.label}-${i + 1}`)}
                                >
                                  {i + 1}
                                </Button>
                              ))}
                            </span>
                          ) : Array.isArray(value) ? (
                            value.join(', ')
                          ) : typeof value === 'object' && value !== null ? (
                            JSON.stringify(value)
                          ) : (
                            String(value ?? '—')
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <span className="row-actions">
                        <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => setSelectedRowId(row.id)}>
                          view
                        </Button>
                        {canModerate &&
                          (confirmDeleteRowId === row.id ? (
                            <>
                              <Button variant="destructive" size="sm" onClick={() => onDelete(row.id)}>
                                confirm
                              </Button>
                              <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => setConfirmDeleteRowId(null)}>
                                cancel
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDeleteRowId(row.id)}>
                              delete
                            </Button>
                          ))}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {(() => {
            const selectedIndex = filteredRows.findIndex((r) => r.id === selectedRowId);
            if (selectedIndex === -1) return null;
            const selected = filteredRows[selectedIndex]!;
            return (
              <ResponseDetailModal
                definition={definition}
                submission={selected}
                index={selectedIndex}
                total={filteredRows.length}
                slug={slug}
                canEdit={canModerate}
                onClose={() => setSelectedRowId(null)}
                onPrev={selectedIndex > 0 ? () => setSelectedRowId(filteredRows[selectedIndex - 1]!.id) : null}
                onNext={
                  selectedIndex < filteredRows.length - 1
                    ? () => setSelectedRowId(filteredRows[selectedIndex + 1]!.id)
                    : null
                }
                onSaved={(updated) =>
                  setRows((current) => current?.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) ?? null)
                }
              />
            );
          })()}
        </section>
      </TabsContent>

      <TabsContent value="summary">
        <section aria-label="response summary">
          {summary === null ? (
            <LoadingState />
          ) : (
            <ResponseSummary data={summary} onFilterByAnswer={onFilterByAnswer} />
          )}
        </section>
      </TabsContent>

      {canManage && (
        <TabsContent value="settings">
          <section aria-label="form settings">
            <FormSettingsPanel
              formId={form.id}
              settings={settings}
              onSaved={(next) => setDetail((d) => (d ? { ...d, settings: next } : d))}
            />
            <ShareLinkPanel formId={form.id} publicToken={form.publicToken} exportToken={form.exportToken} />
            <AccessControlPanel
              formId={form.id}
              restricted={form.restricted}
              onRestrictedChange={(next) =>
                setDetail((d) => (d ? { ...d, form: { ...d.form, restricted: next } } : d))
              }
            />
            <FormKpiMappingsPanel formId={form.id} definition={definition} />
          </section>
        </TabsContent>
      )}
      </Tabs>
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
