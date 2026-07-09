'use client';

import Image from 'next/image';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { BrandIdentity, FormDefinition, FormSettings, SubmissionAnswers } from '@pulse/contracts';
import { FormRenderer, SubmissionScore } from '../../components/form-renderer';
import { API_URL } from '../../lib/api-client';
import { asset } from '../../lib/asset';

/** Anonymous public fill page — no session, reached via a share link/QR. */
function PublicForm() {
  const token = useSearchParams().get('t') ?? '';
  const editToken = useSearchParams().get('edit') ?? '';
  const [data, setData] = useState<{ definition: FormDefinition; settings: FormSettings } | null>(null);
  const [initialAnswers, setInitialAnswers] = useState<SubmissionAnswers | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [branding, setBranding] = useState<BrandIdentity | null>(null);

  useEffect(() => {
    if (!token) return setMissing(true);
    fetch(`${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((env) => (env?.success ? setData(env.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [token]);

  useEffect(() => {
    if (!token || !editToken) return;
    fetch(`${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions/${encodeURIComponent(editToken)}`)
      .then((r) => r.json())
      .then((env) => { if (env?.success) setInitialAnswers(env.data.answers); })
      .catch(() => undefined);
  }, [token, editToken]);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/branding`)
      .then((r) => r.json())
      .then((env) => { if (env?.success) setBranding(env.data); })
      .catch(() => undefined);
  }, []);

  async function submit(answers: object) {
    const url = editToken
      ? `${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions/${encodeURIComponent(editToken)}`
      : `${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions`;
    const res = await fetch(url, {
      method: editToken ? 'PATCH' : 'POST',
      // the anonymous respondent-fingerprint cookie (oneResponsePerUser) is only ever
      // set/read if the browser is allowed to send/receive it on this request
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    });
    const env = await res.json();
    if (!env?.success) throw new Error(env?.error?.message ?? 'Submission failed');
    return env.data as { score?: SubmissionScore | null; editToken?: string | null };
  }

  return (
    <main className="public-fill">
      <header className="public-fill-header" data-surface="purple">
        {branding?.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.companyName} height={42} style={{ height: 42, width: 'auto' }} />
        ) : (
          <Image src={asset('/brand/pulse-neg.svg')} alt="pulse by solutions" width={96} height={42} />
        )}
      </header>
      <div className="portal-main">
        {missing ? (
          <div className="empty-state"><h2>this form link is invalid or expired</h2></div>
        ) : !data ? (
          <p className="muted">loading…</p>
        ) : (
          <FormRenderer
            definition={data.definition}
            settings={data.settings}
            onSubmit={submit}
            uploadPath={`/v1/public/forms/${encodeURIComponent(token)}/uploads`}
            initialAnswers={initialAnswers}
            editUrlFor={(newEditToken) => `?t=${encodeURIComponent(token)}&edit=${encodeURIComponent(newEditToken)}`}
          />
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
