'use client';

import Image from 'next/image';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FormDefinition, FormSettings } from '@pulse/contracts';
import { FormRenderer } from '../../components/form-renderer';
import { API_URL } from '../../lib/api-client';
import { asset } from '../../lib/asset';

/** Anonymous public fill page — no session, reached via a share link/QR. */
function PublicForm() {
  const token = useSearchParams().get('t') ?? '';
  const [data, setData] = useState<{ definition: FormDefinition; settings: FormSettings } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!token) return setMissing(true);
    fetch(`${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((env) => (env?.success ? setData(env.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [token]);

  async function submit(answers: object) {
    const res = await fetch(`${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    });
    const env = await res.json();
    if (!env?.success) throw new Error(env?.error?.message ?? 'Submission failed');
  }

  return (
    <main className="public-fill">
      <header className="public-fill-header" data-surface="purple">
        <Image src={asset('/brand/pulse-neg.svg')} alt="pulse by solutions" width={96} height={42} />
      </header>
      <div className="portal-main">
        {missing ? (
          <div className="empty-state"><h2>this form link is invalid or expired</h2></div>
        ) : !data ? (
          <p className="muted">loading…</p>
        ) : (
          <FormRenderer definition={data.definition} settings={data.settings} onSubmit={submit} />
        )}
      </div>
    </main>
  );
}

export default function PublicFormPage() {
  return (
    <Suspense fallback={null}>
      <PublicForm />
    </Suspense>
  );
}
