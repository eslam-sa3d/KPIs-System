'use client';

import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { PortalShell } from '../../components/portal-shell';
import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '../../lib/use-session';
import { MOCK_FORMS_LIST } from './lib/mock-forms-list';

/**
 * Standalone Google-Forms-parity prototype's home screen — a list of forms,
 * the same way forms.google.com opens on a grid of your recent forms rather
 * than straight into an editor. Wrapped in the regular portal chrome (same
 * as /forms, /dashboard, …) since this is the page the "form builder" nav
 * item lands on; only the editor at /form-builder/edit stays a standalone
 * Google Forms lookalike. Every card below is dummy data (see
 * lib/mock-forms-list.ts); clicking one, or "Blank", opens the one mock form
 * this prototype actually edits.
 */
export default function FormBuilderHomePage() {
  const user = useSession();

  return (
    <PortalShell user={user}>
      <h1>form builder</h1>
      <p className="portal-subtitle">a Google-Forms-style prototype of the form editor</p>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">start a new form</h2>
        <Link href="/form-builder/edit" className="inline-block">
          <Card className="w-36 items-center justify-center gap-2 py-8 transition hover:shadow-md">
            <CardContent className="flex flex-col items-center gap-2 px-0">
              <Plus className="size-8 text-primary" />
              <span className="text-sm text-muted-foreground">blank</span>
            </CardContent>
          </Card>
        </Link>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium">recent forms</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {MOCK_FORMS_LIST.map((item) => (
            <Link key={item.id} href="/form-builder/edit">
              <Card className="gap-0 overflow-hidden py-0 transition hover:shadow-md">
                <div className="flex h-24 items-center justify-center" style={{ background: `${item.color}1a` }}>
                  <FileText className="size-8" style={{ color: item.color }} />
                </div>
                <CardContent className="px-3 py-2">
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.editedLabel} · {item.responseCount === 0 ? 'no responses' : `${item.responseCount} responses`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </PortalShell>
  );
}
