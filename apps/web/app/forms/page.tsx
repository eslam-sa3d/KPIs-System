'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FolderOpen, Pencil, Search, Share2 } from 'lucide-react';
import { PortalShell, can } from '../../components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { StatCard, StatCardIcon } from '@/components/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
        <Button asChild>
          <Link href="/forms/new">new form</Link>
        </Button>
      </div>
      <p className="portal-subtitle">collect data with custom forms, then aggregate and export it</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {forms === null ? (
        <div className="rounded-md border bg-card mt-4 mb-6 p-6" style={{ display: 'flex', justifyContent: 'center' }}>
          <Spinner className="size-6" />
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
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                icon={<StatCardIcon icon={<ClipboardList className="size-5" aria-hidden="true" />} />}
                value={stats.total}
                label={stats.total === 1 ? 'form' : 'forms'}
              />
              <StatCard
                icon={<StatCardIcon icon={<ClipboardList className="size-5" aria-hidden="true" />} />}
                value={stats.open}
                label="accepting responses"
              />
              <StatCard
                icon={<StatCardIcon icon={<Share2 className="size-5" aria-hidden="true" />} />}
                value={stats.shared}
                label="shared publicly"
              />
              {stats.archived > 0 && (
                <StatCard
                  icon={<StatCardIcon icon={<FolderOpen className="size-5" aria-hidden="true" />} />}
                  value={stats.archived}
                  label="archived"
                />
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
              <Select
                value={folderFilter || '__all__'}
                onValueChange={(v) => setFolderFilter(v === '__all__' ? '' : v)}
              >
                <SelectTrigger id="forms-folder-filter" size="sm" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">all folders</SelectItem>
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
              no forms match your filters
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>title</TableHead>
                  <TableHead>status</TableHead>
                  <TableHead>fields</TableHead>
                  <TableHead>version</TableHead>
                  <TableHead>public link</TableHead>
                  <TableHead>folder</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleForms.map((form) => (
                  <TableRow key={form.id} className="hover-actions-row">
                    <TableCell>
                      <Link href={`/forms/view?slug=${encodeURIComponent(form.slug)}`}>{form.title}</Link>
                    </TableCell>
                    <TableCell>
                      {form.status === 'archived' ? (
                        <StatusBadge active={false} label="archived" size="sm" />
                      ) : (
                        <StatusBadge
                          active={form.settings.acceptingResponses}
                          label={form.settings.acceptingResponses ? 'open' : 'closed'}
                          size="sm"
                        />
                      )}
                    </TableCell>
                    <TableCell>{pluralize(form.fieldCount, 'field')}</TableCell>
                    <TableCell>v{form.version}</TableCell>
                    <TableCell>{form.hasPublicLink ? 'shared' : '—'}</TableCell>
                    <TableCell>
                      {editingFolderId === form.id ? (
                        <span className="builder-required">
                          <input
                            aria-label="folder"
                            value={folderDraft}
                            onChange={(e) => setFolderDraft(e.target.value)}
                            placeholder="no folder"
                            style={{ width: 120 }}
                          />
                          <Button type="button" variant="ghost" size="sm" onClick={() => saveFolder(form.id)}>
                            save
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
                          {form.folder ?? 'move to folder'}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="row-actions hover-actions">
                        {can(user, 'forms:write') && (
                          <Button asChild variant="ghost" size="icon-sm" aria-label={`edit ${form.title}`}>
                            <Link href={`/forms/new?edit=${encodeURIComponent(form.slug)}`}>
                              <Pencil size={14} aria-hidden="true" />
                            </Link>
                          </Button>
                        )}
                        {can(user, 'forms:manage') && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-primary hover:text-primary"
                              onClick={() => onArchiveToggle(form)}
                            >
                              {form.status === 'archived' ? 'unarchive' : 'archive'}
                            </Button>
                            {confirmDeleteId === form.id ? (
                              <>
                                <span className="muted">delete?</span>
                                <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(form.id)}>
                                  confirm
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  cancel
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
                                delete
                              </Button>
                            )}
                          </>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </PortalShell>
  );
}
