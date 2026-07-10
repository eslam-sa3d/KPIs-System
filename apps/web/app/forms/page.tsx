'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FolderOpen, Pencil, Search, Share2 } from 'lucide-react';
import { PortalShell, can } from '../../components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';

interface FormListItem {
  id: string;
  slug: string;
  status: string;
  title: string;
  fieldCount: number;
  version: number;
  hasPublicLink: boolean;
  settings: { acceptingResponses: boolean };
  folder: string | null;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function FormsPage() {
  const user = useSession();
  const [forms, setForms] = useState<FormListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = () => api<FormListItem[]>('/v1/forms').then(setForms);

  useEffect(() => {
    if (user) void reload();
  }, [user]);

  async function onArchiveToggle(form: FormListItem) {
    setError(null);
    try {
      await api(`/v1/forms/${form.id}/${form.status === 'archived' ? 'unarchive' : 'archive'}`, {
        method: 'POST',
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the form failed');
    }
  }

  async function onDelete(formId: string) {
    setError(null);
    try {
      await api(`/v1/forms/${formId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the form failed');
    }
  }

  const folders = useMemo(
    () => Array.from(new Set((forms ?? []).map((f) => f.folder).filter((f): f is string => Boolean(f)))).sort(),
    [forms],
  );

  const visibleForms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (forms ?? []).filter(
      (f) => (!folderFilter || f.folder === folderFilter) && (!q || f.title.toLowerCase().includes(q)),
    );
  }, [forms, folderFilter, search]);

  const stats = useMemo(() => {
    if (!forms) return null;
    return {
      total: forms.length,
      open: forms.filter((f) => f.status !== 'archived' && f.settings.acceptingResponses).length,
      shared: forms.filter((f) => f.hasPublicLink).length,
      archived: forms.filter((f) => f.status === 'archived').length,
    };
  }, [forms]);

  async function saveFolder(formId: string) {
    const folder = folderDraft.trim() || null;
    await api(`/v1/forms/${formId}/folder`, { method: 'POST', body: JSON.stringify({ folder }) });
    setForms((current) => current?.map((f) => (f.id === formId ? { ...f, folder } : f)) ?? null);
    setEditingFolderId(null);
  }

  return (
    <PortalShell user={user}>
      <div className="page-title-row">
        <h1>forms</h1>
        <Link href="/forms/new" className="btn-primary">
          new form
        </Link>
      </div>
      <p className="portal-subtitle">collect data with custom forms, then aggregate and export it</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {forms === null ? (
        <div className="rounded-md border bg-card mt-4 mb-6 p-6 space-y-3" aria-hidden="true">
          <Skeleton className="h-3.5" style={{ width: '60%' }} />
          <Skeleton className="h-3.5" style={{ width: '40%' }} />
          <Skeleton className="h-3.5" style={{ width: '50%' }} />
        </div>
      ) : forms.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <ClipboardList size={22} aria-hidden="true" />
          </span>
          <h2>no forms yet</h2>
          <p className="muted">create your first data-entry form to start collecting.</p>
        </div>
      ) : (
        <>
          {stats && (
            <div className="insights-row">
              <div className="insight-card">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <ClipboardList size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.total}</strong>
                  <span>{stats.total === 1 ? 'form' : 'forms'}</span>
                </span>
              </div>
              <div className="insight-card">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <ClipboardList size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.open}</strong>
                  <span>accepting responses</span>
                </span>
              </div>
              <div className="insight-card">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <Share2 size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.shared}</strong>
                  <span>shared publicly</span>
                </span>
              </div>
              {stats.archived > 0 && (
                <div className="insight-card">
                  <span className="hierarchy-icon hierarchy-icon-sm">
                    <FolderOpen size={15} aria-hidden="true" />
                  </span>
                  <span className="insight-card-body">
                    <strong>{stats.archived}</strong>
                    <span>archived</span>
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="kpi-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search forms by title…"
              aria-label="search forms"
            />
          </div>

          {folders.length > 0 && (
            <div className="page-title-row" style={{ marginBottom: 8 }}>
              <label htmlFor="forms-folder-filter" className="muted" style={{ fontSize: 13 }}>
                folder
              </label>
              <select
                id="forms-folder-filter"
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
              >
                <option value="">all folders</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          )}

          {visibleForms.length === 0 ? (
            <p className="empty-state-inline">
              <Search size={14} aria-hidden="true" />
              no forms match your filters
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>title</th>
                  <th>status</th>
                  <th>fields</th>
                  <th>version</th>
                  <th>public link</th>
                  <th>folder</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleForms.map((form) => (
                  <tr key={form.id} className="hover-actions-row">
                    <td>
                      <Link href={`/forms/view?slug=${encodeURIComponent(form.slug)}`}>{form.title}</Link>
                    </td>
                    <td>
                      {form.status === 'archived' ? (
                        <StatusBadge active={false} label="archived" size="sm" />
                      ) : (
                        <StatusBadge
                          active={form.settings.acceptingResponses}
                          label={form.settings.acceptingResponses ? 'open' : 'closed'}
                          size="sm"
                        />
                      )}
                    </td>
                    <td>{pluralize(form.fieldCount, 'field')}</td>
                    <td>v{form.version}</td>
                    <td>{form.hasPublicLink ? 'shared' : '—'}</td>
                    <td>
                      {editingFolderId === form.id ? (
                        <span className="builder-required">
                          <input
                            aria-label="folder"
                            value={folderDraft}
                            onChange={(e) => setFolderDraft(e.target.value)}
                            placeholder="no folder"
                            style={{ width: 120 }}
                          />
                          <button type="button" className="btn-ghost" onClick={() => saveFolder(form.id)}>
                            save
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => {
                            setEditingFolderId(form.id);
                            setFolderDraft(form.folder ?? '');
                          }}
                        >
                          {form.folder ?? 'move to folder'}
                        </button>
                      )}
                    </td>
                    <td>
                      <span className="row-actions hover-actions">
                        {can(user, 'forms:write') && (
                          <Link
                            href={`/forms/new?edit=${encodeURIComponent(form.slug)}`}
                            className="icon-btn"
                            aria-label={`edit ${form.title}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Link>
                        )}
                        {can(user, 'forms:manage') && (
                          <>
                            <button type="button" className="btn-text" onClick={() => onArchiveToggle(form)}>
                              {form.status === 'archived' ? 'unarchive' : 'archive'}
                            </button>
                            {confirmDeleteId === form.id ? (
                              <>
                                <span className="muted">delete?</span>
                                <button
                                  type="button"
                                  className="btn-text btn-text-danger"
                                  onClick={() => onDelete(form.id)}
                                >
                                  confirm
                                </button>
                                <button type="button" className="btn-text" onClick={() => setConfirmDeleteId(null)}>
                                  cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn-text btn-text-danger"
                                onClick={() => setConfirmDeleteId(form.id)}
                              >
                                delete
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </PortalShell>
  );
}
