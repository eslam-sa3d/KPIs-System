'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { FormDefinition, FormSettings, SubmissionAnswers } from '@pulse/contracts';
import { PortalShell, can } from '../../../components/portal-shell';
import { FormRenderer } from '../../../components/form-renderer';
import { FormSettingsPanel } from '../../../components/form-settings-panel';
import { ShareLinkPanel } from '../../../components/share-link-panel';
import { ResponseSummary, ResponseSummaryData } from '../../../components/response-summary';
import { ResponseDetailModal } from '../../../components/response-detail-modal';
import { api, downloadFile } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface FormDetail {
  form: { id: string; slug: string; status: string; publicToken: string | null };
  version: { id: string; version: number };
  definition: FormDefinition;
  settings: FormSettings;
}

interface SubmissionRow {
  id: string;
  createdAt: string;
  answers: SubmissionAnswers;
  submittedBy: { displayName: string; email: string } | null;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const reloadDetail = useCallback(() => {
    if (slug) void api<FormDetail>(`/v1/forms/${encodeURIComponent(slug)}`).then(setDetail);
  }, [slug]);

  useEffect(() => {
    if (user) reloadDetail();
  }, [user, reloadDetail]);

  useEffect(() => {
    if (!user || !slug) return;
    if (tab === 'submissions') {
      void api<SubmissionRow[]>(`/v1/forms/${encodeURIComponent(slug)}/submissions?pageSize=100`).then(setRows);
    }
    if (tab === 'summary') {
      void api<ResponseSummaryData>(`/v1/forms/${encodeURIComponent(slug)}/submissions/summary`).then(setSummary);
    }
  }, [user, slug, tab]);

  async function onSubmit(answers: SubmissionAnswers) {
    await api(`/v1/forms/${encodeURIComponent(slug)}/submissions`, {
      method: 'POST',
      body: JSON.stringify(answers),
    });
  }

  async function onDelete(submissionId: string) {
    if (!window.confirm('Delete this submission? This cannot be undone.')) return;
    await api(`/v1/forms/${slug}/submissions/${submissionId}`, { method: 'DELETE' });
    setRows((current) => (current ? current.filter((r) => r.id !== submissionId) : current));
    setNotice('submission deleted');
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
        <p className="muted">loading…</p>
      </PortalShell>
    );
  }

  const { definition, settings, form } = detail;
  const filteredRows = (rows ?? []).filter((row) => {
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
        <div role="tablist" className="tabs" aria-label="form views">
          <button role="tab" aria-selected={tab === 'form'} onClick={() => setTab('form')}>
            form
          </button>
          <button role="tab" aria-selected={tab === 'submissions'} onClick={() => setTab('submissions')}>
            submissions
          </button>
          <button role="tab" aria-selected={tab === 'summary'} onClick={() => setTab('summary')}>
            summary
          </button>
          {canManage && (
            <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>
              settings
            </button>
          )}
        </div>
        {canManage && (
          <button className="btn-ghost" onClick={onDuplicate}>
            duplicate form
          </button>
        )}
      </div>

      {tab === 'form' && <FormRenderer definition={definition} settings={settings} onSubmit={onSubmit} />}

      {tab === 'submissions' && (
        <section role="tabpanel" aria-label="submissions">
          <div className="page-title-row">
            <input
              aria-label="filter submissions"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="btn-ghost"
              onClick={() => downloadFile(`/v1/forms/${slug}/submissions/export`, `${slug}.csv`)}
            >
              export CSV
            </button>
          </div>
          {notice && <p className="form-notice">{notice}</p>}
          {rows === null ? (
            <p className="muted">loading…</p>
          ) : filteredRows.length === 0 ? (
            <p className="muted">no submissions{filter ? ' match the filter' : ' yet'}.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>submitted</th>
                  <th>by</th>
                  {definition.fields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.submittedBy?.displayName ?? 'anonymous'}</td>
                    {definition.fields.map((f) => {
                      const value = row.answers[f.key];
                      return (
                        <td key={f.key}>
                          {Array.isArray(value)
                            ? value.join(', ')
                            : typeof value === 'object' && value !== null
                              ? JSON.stringify(value)
                              : String(value ?? '—')}
                        </td>
                      );
                    })}
                    <td>
                      <span className="builder-field-actions">
                        <button className="btn-ghost" onClick={() => setSelectedRowId(row.id)}>
                          view
                        </button>
                        {canModerate && (
                          <button className="btn-ghost" onClick={() => onDelete(row.id)}>
                            delete
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                onClose={() => setSelectedRowId(null)}
                onPrev={selectedIndex > 0 ? () => setSelectedRowId(filteredRows[selectedIndex - 1]!.id) : null}
                onNext={
                  selectedIndex < filteredRows.length - 1
                    ? () => setSelectedRowId(filteredRows[selectedIndex + 1]!.id)
                    : null
                }
              />
            );
          })()}
        </section>
      )}

      {tab === 'summary' && (
        <section role="tabpanel" aria-label="response summary">
          {summary === null ? <p className="muted">loading…</p> : <ResponseSummary data={summary} />}
        </section>
      )}

      {tab === 'settings' && canManage && (
        <section role="tabpanel" aria-label="form settings">
          <FormSettingsPanel
            formId={form.id}
            settings={settings}
            onSaved={(next) => setDetail((d) => (d ? { ...d, settings: next } : d))}
          />
          <ShareLinkPanel formId={form.id} publicToken={form.publicToken} />
        </section>
      )}
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
