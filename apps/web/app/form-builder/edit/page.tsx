'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { BuilderShell } from '../components/builder-shell';
import { useBuilderStore } from '../lib/store';

/**
 * Standalone Google-Forms-parity prototype. Local state + mock data only —
 * not wired to @pulse/contracts or the API. See lib/types.ts for the schema.
 *
 * The store is a client-side singleton that outlives navigation, so which
 * form is loaded here is decided fresh on every mount rather than trusting
 * whatever was left over from a previous visit: ?new=1 (the list page's
 * "new form"/"blank" links) starts a blank form; opening this route any
 * other way (a title row on the list) loads the demo form.
 */
function FormBuilderEditContent() {
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

  return <BuilderShell />;
}

export default function FormBuilderEditPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <Suspense fallback={null}>
      <FormBuilderEditContent />
    </Suspense>
  );
}
