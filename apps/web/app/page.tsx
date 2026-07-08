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

const INDUSTRIES = [
  { image: '/brand/photos/power-edit1.jpg', label: 'energy' },
  { image: '/brand/photos/smart-cities-edit1.jpg', label: 'smart cities' },
  { image: '/brand/photos/manufacturing-edit1.webp', label: 'manufacturing' },
  { image: '/brand/photos/telecome-edit-1.webp', label: 'telecom' },
  { image: '/brand/photos/financial-edit1.webp', label: 'financial' },
  { image: '/brand/photos/health-edit2.webp', label: 'healthcare' },
];

const FEATURES = [
  {
    title: 'KPIs that know their audience',
    body: 'define once, map to roles, departments, or delivery streams — every dashboard scopes itself to whoever signed in.',
  },
  {
    title: 'forms built in minutes',
    body: 'schema-driven builder with nine field types, conditional logic, versioning, and one-click CSV export.',
  },
  {
    title: 'security that keeps receipts',
    body: 'dynamic roles, rotating sessions, and an audit trail behind every permission, mapping, and export.',
  },
];

/**
 * Public landing page. Identity (name, headline, tagline, logo) is
 * admin-customizable via /v1/branding — defaults render instantly and the
 * fetched identity hydrates over them.
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
    <main className="landing" data-surface="purple">
      <header className="landing-header">
        <Image src={logo} alt={identity.companyName} width={128} height={56} priority unoptimized />
        <Link href="/login" className="btn-primary">
          sign in
        </Link>
      </header>

      {/* ── hero: headline + brand diamond mosaic ─────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <h1>{identity.headline ?? DEFAULT_IDENTITY.headline}</h1>
          <p className="landing-tagline">
            {identity.tagline ?? DEFAULT_IDENTITY.tagline} — define KPIs, collect data with custom
            forms, and see performance the moment it moves.
          </p>
          <div className="landing-cta-row">
            <Link href="/login" className="btn-primary">
              enter the portal
            </Link>
            <a href="#platform" className="btn-ghost landing-ghost">
              see the platform
            </a>
          </div>
        </div>
        <div className="landing-hero-art" aria-hidden="true">
          <Image
            src={asset('/brand/photos/pulse-img-1.png')}
            alt=""
            width={560}
            height={470}
            priority
            unoptimized
          />
        </div>
      </section>

      {/* ── stat strip: bold reserved for numbers, per brand rules ── */}
      <section className="landing-stats" aria-label="platform facts">
        <div>
          <strong>9</strong>
          <span>form field types</span>
        </div>
        <div>
          <strong>36</strong>
          <span>composable permissions</span>
        </div>
        <div>
          <strong>100%</strong>
          <span>audit-logged changes</span>
        </div>
      </section>

      {/* ── features ────────────────────────────────────────────── */}
      <section className="landing-features" id="platform">
        <h2>one platform, every signal</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── industries: diamond tiles echo the brand mark ──────────── */}
      <section className="landing-industries" aria-label="industries served">
        <h2>trusted where downtime isn’t an option</h2>
        <div className="landing-diamond-row">
          {INDUSTRIES.map((industry) => (
            <figure key={industry.label}>
              <span className="diamond-frame">
                <Image
                  src={asset(industry.image)}
                  alt={industry.label}
                  width={180}
                  height={180}
                  unoptimized
                />
              </span>
              <figcaption>{industry.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── HQ band ─────────────────────────────────────────────── */}
      <section
        className="landing-band"
        style={{ backgroundImage: `url(${asset('/brand/photos/new-edit-2.webp')})` }}
      >
        <div className="landing-band-inner">
          <h2>built by {identity.companyName}</h2>
          <p>engineered end-to-end — from the data model to the pixel — on the pulse brand system.</p>
          <Link href="/login" className="btn-primary">
            get started
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <Image src={asset('/brand/pulse-neg.svg')} alt={identity.companyName} width={96} height={42} unoptimized />
        <span className="muted">© {new Date().getFullYear()} {identity.companyName}</span>
      </footer>
    </main>
  );
}
