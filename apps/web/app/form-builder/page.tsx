'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search, Share2 } from 'lucide-react';
import { PortalShell } from '../../components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
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

/**
 * Home screen for the Google-Forms-parity prototype: the same real forms
 * list as /forms (stat tiles, search, folder filter, table), so this reads
 * like the actual portal rather than a mock-only page. The one deliberate
 * prototype seam: every title/"new form" link opens the standalone mock
 * editor at /form-builder/edit instead of the real per-form editor,
 * regardless of which row was clicked — there's no per-form editing wired
 * up here yet.
 */
export default function FormBuilderHomePage() {
  const user = useSession();
  const [forms, setForms] = useState<FormListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');

  useEffect(() => {
    if (user) void api<FormListItem[]>('/v1/forms').then(setForms);
  }, [user]);

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
        <h1>form builder</h1>
        <Button asChild>
          <Link href="/form-builder/edit?new=1">new form</Link>
        </Button>
      </div>
      <p className="portal-subtitle">a Google-Forms-style prototype of the form editor</p>

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
            <div className="insights-row">
              <div className="insight-card tone-purple">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <ClipboardList size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.total}</strong>
                  <span>{stats.total === 1 ? 'form' : 'forms'}</span>
                </span>
              </div>
              <div className="insight-card tone-green">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <ClipboardList size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.open}</strong>
                  <span>accepting responses</span>
                </span>
              </div>
              <div className="insight-card tone-blue">
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <Share2 size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats.shared}</strong>
                  <span>shared publicly</span>
                </span>
              </div>
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
              <label htmlFor="form-builder-folder-filter" className="muted" style={{ fontSize: 13 }}>
                folder
              </label>
              <Select
                value={folderFilter || '__all__'}
                onValueChange={(v) => setFolderFilter(v === '__all__' ? '' : v)}
              >
                <SelectTrigger id="form-builder-folder-filter" size="sm" className="w-[180px]">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleForms.map((form) => (
                  <TableRow key={form.id}>
                    <TableCell>
                      <Link href="/form-builder/edit">{form.title}</Link>
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
