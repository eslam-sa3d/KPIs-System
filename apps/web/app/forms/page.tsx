'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
}

export default function FormsPage() {
  const user = useSession();
  const [forms, setForms] = useState<FormListItem[] | null>(null);

  useEffect(() => {
    if (user) void api<FormListItem[]>('/v1/forms').then(setForms);
  }, [user]);

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
        <table className="data-table">
          <thead>
            <tr>
              <th>title</th>
              <th>status</th>
              <th>responses</th>
              <th>fields</th>
              <th>version</th>
              <th>public link</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((form) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PortalShell>
  );
}
