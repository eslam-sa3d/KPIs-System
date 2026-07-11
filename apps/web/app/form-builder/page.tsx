'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PortalShell } from '../../components/portal-shell';
import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '../../lib/use-session';

/**
 * Standalone Google-Forms-parity prototype's home screen — a list of forms,
 * the same way forms.google.com opens on a grid of your recent forms rather
 * than straight into an editor. Wrapped in the regular portal chrome (same
 * as /forms, /dashboard, …) since this is the page the "form builder" nav
 * item lands on; only the editor at /form-builder/edit stays a standalone
 * Google Forms lookalike. This prototype has no per-form storage, so
 * there's no real "recent forms" list to show — "blank" opens the one mock
 * form the editor actually edits.
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
    </PortalShell>
  );
}
