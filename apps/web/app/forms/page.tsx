'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '../../components/portal-shell';
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

export default function FormsPage() {
  const user = useSession();
  const [forms, setForms] = useState<FormListItem[] | null>(null);
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
  const visibleForms = (forms ?? []).filter((f) => !folderFilter || f.folder === folderFilter);

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

      {forms === null ? (
        <p className="muted">loading…</p>
      ) : forms.length === 0 ? (
        <div className="empty-state">
          <h2>no forms yet</h2>
          <p className="muted">create your first data-entry form to start collecting.</p>
        </div>
      ) : (
        <>
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
          <table className="data-table">
            <thead>
              <tr>
                <th>title</th>
                <th>status</th>
                <th>responses</th>
                <th>fields</th>
                <th>version</th>
                <th>public link</th>
                <th>folder</th>
              </tr>
            </thead>
            <tbody>
              {visibleForms.map((form) => (
                <tr key={form.id}>
                  <td>
                    <Link href={`/forms/view?slug=${encodeURIComponent(form.slug)}`}>
                      {form.title}
                    </Link>
                  </td>
                  <td>{form.status}</td>
                  <td>{form.settings.acceptingResponses ? 'open' : 'closed'}</td>
                  <td>{form.fieldCount}</td>
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
                        className="btn-ghost"
                        onClick={() => {
                          setEditingFolderId(form.id);
                          setFolderDraft(form.folder ?? '');
                        }}
                      >
                        {form.folder ?? 'move to folder'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </PortalShell>
  );
}
