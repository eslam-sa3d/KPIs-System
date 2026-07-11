'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalShell } from '../../../components/portal-shell';
import { BuilderShell } from '../components/builder-shell';
import { useBuilderStore } from '../lib/store';
import { useSession } from '../../../lib/use-session';

/**
 * Standalone Google-Forms-parity prototype. Local state + mock data only —
 * not wired to @pulse/contracts or the API. See lib/types.ts for the schema.
 *
 * The store is a client-side singleton that outlives navigation, so which
 * form is loaded here is decided fresh on every mount rather than trusting
 * whatever was left over from a previous visit: ?new=1 (the list page's
 * "new form"/"blank" links) starts a blank form; opening this route any
 * other way (a title row on the list) loads the demo form.
 *
 * Wrapped in the regular PortalShell (fullBleedMain, so BuilderShell keeps
 * its edge-to-edge Google Forms look) — every other authenticated page in
 * the app keeps the pulse header visible, and this one shouldn't be the
 * one exception.
 */
function FormBuilderEditContent() {
  const user = useSession();
  const isNew = useSearchParams().get('new') === '1';
  const newForm = useBuilderStore((s) => s.newForm);
  const loadDemoForm = useBuilderStore((s) => s.loadDemoForm);

  useEffect(() => {
    if (isNew) {
      newForm();
    } else {
      loadDemoForm();
    }
  }, [isNew]);

  return (
    <PortalShell user={user} fullBleedMain>
      <BuilderShell />
    </PortalShell>
  );
}

export default function FormBuilderEditPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <Suspense fallback={null}>
      <FormBuilderEditContent />
    </Suspense>
  );
}
