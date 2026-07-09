'use client';

import Image from 'next/image';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { BrandIdentity, FormDefinition, FormSettings, SubmissionAnswers } from '@pulse/contracts';
import { FormRenderer, SubmissionScore } from '../../components/form-renderer';
import { API_URL } from '../../lib/api-client';
import { asset } from '../../lib/asset';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
  }
}

/** Anonymous public fill page — no session, reached via a share link/QR. */
function PublicForm() {
  const token = useSearchParams().get('t') ?? '';
  const editToken = useSearchParams().get('edit') ?? '';
  const [data, setData] = useState<{ definition: FormDefinition; settings: FormSettings } | null>(null);
  const [initialAnswers, setInitialAnswers] = useState<SubmissionAnswers | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [branding, setBranding] = useState<BrandIdentity | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

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

  // loads Cloudflare Turnstile only for forms that require it; a real site key must also be
  // configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY) or the widget silently never renders — same
  // "safe when unconfigured" pattern as the server-side check in TurnstileService.
  useEffect(() => {
    if (!data?.settings.requireCaptcha || !TURNSTILE_SITE_KEY) return;
    function renderWidget() {
      if (turnstileRef.current && window.turnstile) {
        window.turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY!,
          callback: (widgetToken: string) => setTurnstileToken(widgetToken),
        });
      }
    }
    if (document.getElementById(TURNSTILE_SCRIPT_ID)) {
      renderWidget();
      return;
    }
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = renderWidget;
    document.body.appendChild(script);
  }, [data?.settings.requireCaptcha]);

  async function submit(answers: object) {
    const url = editToken
      ? `${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions/${encodeURIComponent(editToken)}`
      : `${API_URL}/api/v1/public/forms/${encodeURIComponent(token)}/submissions`;
    const res = await fetch(url, {
      method: editToken ? 'PATCH' : 'POST',
      // the anonymous respondent-fingerprint cookie (oneResponsePerUser) is only ever
      // set/read if the browser is allowed to send/receive it on this request
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(turnstileToken ? { 'x-turnstile-token': turnstileToken } : {}),
      },
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
            captchaSlot={
              data.settings.requireCaptcha && TURNSTILE_SITE_KEY ? <div ref={turnstileRef} /> : undefined
            }
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
