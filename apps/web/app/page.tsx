'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BrandIdentity } from '@pulse/contracts';
import { API_URL } from '../lib/api-client';
import { asset } from '../lib/asset';

const DEFAULT_IDENTITY: BrandIdentity = {
  companyName: 'pulse by solutions',
  headline: 'elevating what matters',
  tagline: 'the intelligence behind what can’t fail',
};

/**
 * Public landing page. The identity (name, headline, tagline, logo) is
 * admin-customizable via /v1/branding — defaults render instantly and the
 * fetched identity hydrates over them, so an unreachable API never blanks
 * the page.
 */
export default function LandingPage() {
  const [identity, setIdentity] = useState<BrandIdentity>(DEFAULT_IDENTITY);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/branding`)
      .then((res) => res.json())
      .then((envelope) => envelope?.success && setIdentity(envelope.data))
      .catch(() => undefined); // keep defaults
  }, []);

  const logo = identity.logoUrl || asset('/brand/pulse-neg.svg');

  return (
    <main data-surface="purple" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-6) var(--space-12)',
        }}
      >
        <Image src={logo} alt={identity.companyName} width={140} height={61} priority unoptimized />
        <Link href="/login" className="btn-primary">
          sign in
        </Link>
      </header>

      <section
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: 'var(--space-16) var(--space-8)',
          color: 'var(--color-text)',
        }}
      >
        {/* lowercase headline per brand guidelines */}
        <h1 style={{ fontSize: 'var(--font-size-display)' }}>
          {identity.headline ?? DEFAULT_IDENTITY.headline}
        </h1>
        <p
          style={{
            marginTop: 'var(--space-4)',
            fontSize: 'var(--font-size-lg)',
            color: 'var(--color-text-muted)',
            maxWidth: 560,
          }}
        >
          {identity.tagline ?? DEFAULT_IDENTITY.tagline} — define KPIs, collect data with custom
          forms, and see performance the moment it moves.
        </p>
        <div style={{ marginTop: 'var(--space-8)' }}>
          <Link href="/login" className="btn-primary">
            enter the portal
          </Link>
        </div>
      </section>
    </main>
  );
}
