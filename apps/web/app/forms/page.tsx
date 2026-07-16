'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, FolderOpen, Pencil, Search, Share2 } from 'lucide-react';
import type { FormListItem } from '@pulse/contracts';
import { PortalShell, can } from '../../components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import { useResource } from '../../lib/use-resource';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const FORMS_PAGE_SIZE = 25;

export default function FormsPage() {
  const user = useSession();
  const { data: forms, reload, setData: setForms } = useResource<FormListItem[]>(user ? '/v1/forms' : null);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  async function onArchiveToggle(form: FormListItem) {
    setError(null);
    try {
      await api(`/v1/forms/${form.id}/${form.status === 'archived' ? 'unarchive' : 'archive'}`, {
        method: 'POST',
      });
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the form failed');
    }
  }

  async function onDelete(formId: string) {
    setError(null);
    try {
      await api(`/v1/forms/${formId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      reload();
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

  // Narrowing the search/folder filter can leave `page` pointing past the
  // now-shorter result set — snap back to the first page instead of showing
  // an empty page with working Previous/Next controls that look broken.
  useEffect(() => {
    setPage(1);
  }, [search, folderFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleForms.length / FORMS_PAGE_SIZE));
  const pagedForms = useMemo(
    () => visibleForms.slice((page - 1) * FORMS_PAGE_SIZE, page * FORMS_PAGE_SIZE),
    [visibleForms, page],
  );

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
      <div>
        <div className="page-title-row">
          <h1>Forms</h1>
          <Button asChild>
            <Link href="/forms/new">New form</Link>
          </Button>
        </div>
        <p className="portal-subtitle">Collect data with custom forms, then aggregate and export it</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {forms === null ? (
          <div
            className="rounded-md border bg-card mt-4 mb-6 p-6"
            style={{ display: 'flex', justifyContent: 'center' }}
          >
            <Spinner className="size-6" />
          </div>
        ) : forms.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">
              <ClipboardList size={22} aria-hidden="true" />
            </span>
            <h2>No forms yet</h2>
            <p className="muted">Create your first data-entry form to start collecting.</p>
          </div>
        ) : (
          <>
            {stats && (
              <div className="insights-row">
                <div className="insight-card tone-purple">
                  <span className="hierarchy-icon hierarchy-icon-sm">
                    <ClipboardList size={15} aria-hidden="true" />
                  </span>
                  <span className="insight-card-body">
                    <strong>{stats.total}</strong>
                    <span>{stats.total === 1 ? 'Form' : 'Forms'}</span>
                  </span>
                </div>
                <div className="insight-card tone-green">
                  <span className="hierarchy-icon hierarchy-icon-sm">
                    <ClipboardList size={15} aria-hidden="true" />
                  </span>
                  <span className="insight-card-body">
                    <strong>{stats.open}</strong>
                    <span>Accepting responses</span>
                  </span>
                </div>
                <div className="insight-card tone-blue">
                  <span className="hierarchy-icon hierarchy-icon-sm">
                    <Share2 size={15} aria-hidden="true" />
                  </span>
                  <span className="insight-card-body">
                    <strong>{stats.shared}</strong>
                    <span>Shared publicly</span>
                  </span>
                </div>
                {stats.archived > 0 && (
                  <div className="insight-card tone-gray">
                    <span className="hierarchy-icon hierarchy-icon-sm">
                      <FolderOpen size={15} aria-hidden="true" />
                    </span>
                    <span className="insight-card-body">
                      <strong>{stats.archived}</strong>
                      <span>Archived</span>
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
                placeholder="Search forms by title…"
                aria-label="Search forms"
              />
            </div>

            {folders.length > 0 && (
              <div className="page-title-row" style={{ marginBottom: 8 }}>
                <label htmlFor="forms-folder-filter" className="muted" style={{ fontSize: 13 }}>
                  Folder
                </label>
                <Select
                  value={folderFilter || '__all__'}
                  onValueChange={(v) => setFolderFilter(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger id="forms-folder-filter" size="sm" className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All folders</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {visibleForms.length === 0 ? (
              <p className="empty-state-inline">
                <Search size={14} aria-hidden="true" />
                No forms match your filters
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fields</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Public link</TableHead>
                    <TableHead>Folder</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedForms.map((form) => (
                    <TableRow key={form.id} className="hover-actions-row">
                      <TableCell>
                        <Link href={`/forms/view?slug=${encodeURIComponent(form.slug)}`}>{form.title}</Link>
                      </TableCell>
                      <TableCell>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {form.status === 'archived' ? (
                            <StatusBadge active={false} label="Archived" size="sm" />
                          ) : (
                            <StatusBadge
                              active={form.settings.acceptingResponses}
                              label={form.settings.acceptingResponses ? 'Open' : 'Closed'}
                              size="sm"
                            />
                          )}
                          {(form.hasSubmissionGap || form.mappedWhileClosed) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Form health warning"
                                  style={{
                                    display: 'inline-flex',
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'default',
                                    color: 'var(--amber)',
                                  }}
                                >
                                  <AlertTriangle size={14} aria-hidden="true" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {form.hasSubmissionGap && <p>Open, but no submissions in 30+ days</p>}
                                {form.mappedWhileClosed && <p>Linked to a KPI, but not currently reachable</p>}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{pluralize(form.fieldCount, 'field')}</TableCell>
                      <TableCell>v{form.version}</TableCell>
                      <TableCell>{form.hasPublicLink ? 'Shared' : '—'}</TableCell>
                      <TableCell>
                        {editingFolderId === form.id ? (
                          <span className="builder-required">
                            <input
                              aria-label="folder"
                              value={folderDraft}
                              onChange={(e) => setFolderDraft(e.target.value)}
                              placeholder="No folder"
                              style={{ width: 120 }}
                            />
                            <Button type="button" variant="ghost" size="sm" onClick={() => saveFolder(form.id)}>
                              Save
                            </Button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:text-primary"
                            onClick={() => {
                              setEditingFolderId(form.id);
                              setFolderDraft(form.folder ?? '');
                            }}
                          >
                            {form.folder ?? 'Move to folder'}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="row-actions hover-actions">
                          {can(user, 'forms:edit') && (
                            <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${form.title}`}>
                              <Link href={`/forms/new?edit=${encodeURIComponent(form.slug)}`}>
                                <Pencil size={14} aria-hidden="true" />
                              </Link>
                            </Button>
                          )}
                          {can(user, 'forms:activate_deactivate') && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-primary hover:text-primary"
                              onClick={() => onArchiveToggle(form)}
                            >
                              {form.status === 'archived' ? 'Unarchive' : 'Archive'}
                            </Button>
                          )}
                          {can(user, 'forms:delete') &&
                            (confirmDeleteId === form.id ? (
                              <>
                                <span className="muted">Delete?</span>
                                <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(form.id)}>
                                  Confirm
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setConfirmDeleteId(form.id)}
                              >
                                Delete
                              </Button>
                            ))}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {visibleForms.length > 0 && (
              <div className="page-title-row" aria-label="Forms pagination">
                <span className="muted">
                  Showing {(page - 1) * FORMS_PAGE_SIZE + 1}
                  {'–'}
                  {Math.min(page * FORMS_PAGE_SIZE, visibleForms.length)} of {visibleForms.length}
                </span>
                <span className="row-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="muted">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
