'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, ChevronRight, ClipboardList, Lightbulb, Search, Settings, Shield, Target, Users } from 'lucide-react';
import type { BrandIdentity } from '@pulse/contracts';
import { LandingHeroIllustration } from '../components/landing-hero-illustration';
import { Button } from '@/components/ui/button';
import { API_URL } from '../lib/api-client';
import { asset } from '../lib/asset';

const DEFAULT_IDENTITY: BrandIdentity = {
  companyName: 'pulse by solutions',
  headline: 'elevating what matters',
  tagline: 'the intelligence behind what can’t fail',
};

const PIPELINE = [
  { icon: ClipboardList, label: 'plan' },
  { icon: Settings, label: 'execute' },
  { icon: Search, label: 'test' },
  { icon: BarChart3, label: 'deliver' },
];

const STATS = [
  { value: '99.8%', label: 'test coverage' },
  { value: '350+', label: 'apps delivered' },
  { value: '4.9×', label: 'faster releases' },
];

const PILLARS = [
  { icon: Target, title: 'quality', body: 'we deliver excellence in every build, test, and release cycle.' },
  { icon: Users, title: 'collaboration', body: 'we achieve more together — one team, one mission.' },
  { icon: Lightbulb, title: 'innovation', body: 'we embrace change and bring new ideas to every challenge.' },
  { icon: Shield, title: 'ownership', body: 'we take pride in our work and own outcomes end-to-end.' },
];

function HeartbeatLine({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 20" fill="none" aria-hidden="true">
      <path
        d="M0 10 L10 10 L15 4 L20 16 L25 10 L35 10 L40 2 L45 18 L50 10 L80 10"
        stroke="var(--pulse-coral)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Public landing page. Identity (name, headline, tagline, logo) is
 * admin-customizable via /v1/branding — defaults render instantly and the
 * fetched identity hydrates over them. The header and footer read from it;
 * the hero/pipeline/pillars content below is fixed brand copy.
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
    <main className="landing">
      <header className="landing-header" data-surface="purple">
        <Image src={logo} alt={identity.companyName} width={128} height={56} priority unoptimized />
        <Button asChild>
          <Link href="/login">sign in</Link>
        </Button>
      </header>

      {/* ── hero ────────────────────────────────────────────────── */}
      <section className="landing-hero" data-surface="purple">
        <div className="landing-hero-bg" aria-hidden="true" />
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h1 className="landing-hero-heading">
              GDC
              <br />
              <span className="landing-hero-accent">DIGITAL APPS</span>
              <br />
              TESTING TEAM
            </h1>
            <p className="landing-tagline">
              Quality Today, <strong className="landing-accent-text">Excellence Tomorrow</strong>
            </p>
            <div className="landing-heartbeat-row">
              <HeartbeatLine className="landing-heartbeat" />
              <p className="landing-heartbeat-copy">
                <strong>Our Pulse.</strong> <strong className="landing-accent-text">Our People.</strong>{' '}
                <strong>Our Purpose.</strong>
              </p>
            </div>
          </div>
          <div className="landing-hero-art">
            <LandingHeroIllustration />
          </div>
        </div>

        <div className="landing-pipeline">
          <div className="landing-pipeline-row">
            {PIPELINE.map(({ icon: Icon, label }, idx) => (
              <span className="landing-pipeline-item" key={label}>
                <span className="landing-pipeline-pill">
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </span>
                {idx < PIPELINE.length - 1 && <ChevronRight size={15} className="landing-pipeline-chevron" aria-hidden="true" />}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── stats ───────────────────────────────────────────────── */}
      <section className="landing-stats" aria-label="platform facts">
        {STATS.map(({ value, label }) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      {/* ── pillars ─────────────────────────────────────────────── */}
      <section className="landing-pillars">
        <div className="landing-pillars-head">
          <p className="landing-eyebrow">our foundation</p>
          <h2>built on four pillars</h2>
          <p className="landing-pillars-sub">the values that drive every test case, every sprint, every release.</p>
        </div>
        <div className="landing-pillar-grid">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="landing-pillar-card">
              <span className="landing-pillar-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
              <span className="landing-pillar-underline" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────────── */}
      <section className="landing-cta-band" data-surface="purple">
        <div className="landing-cta-band-bg" aria-hidden="true" />
        <div className="landing-cta-band-inner">
          <HeartbeatLine className="landing-heartbeat landing-heartbeat-lg" />
          <h2 className="landing-cta-heading">
            Our Pulse. <span className="landing-hero-accent">Our People.</span> Our Purpose.
          </h2>
          <p className="landing-tagline">Together, we build quality that drives impact.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <Image src={asset('/brand/pulse-neg.svg')} alt={identity.companyName} width={96} height={42} unoptimized />
        <span className="muted">
          © {new Date().getFullYear()} {identity.companyName}
        </span>
      </footer>
    </main>
  );
}
