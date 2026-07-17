import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  Lightbulb,
  Search,
  Settings,
  Shield,
  Target,
  Users,
} from 'lucide-react';
import type { BrandIdentity } from '@pulse/contracts';
import { LandingHeroIllustration } from '../components/landing-hero-illustration';
import { LandingHeader } from '../components/landing-header';
import { LandingFooter } from '../components/landing-footer';

const DEFAULT_IDENTITY: BrandIdentity = {
  companyName: 'pulse by solutions',
  headline: 'Elevating what matters',
  tagline: 'The intelligence behind what can’t fail',
};

const PIPELINE = [
  { icon: ClipboardList, label: 'Plan' },
  { icon: Settings, label: 'Execute' },
  { icon: Search, label: 'Test' },
  { icon: BarChart3, label: 'Deliver' },
];

const STATS = [
  { value: '99.8%', label: 'Test coverage' },
  { value: '350+', label: 'Apps delivered' },
  { value: '4.9×', label: 'Faster releases' },
];

const PILLARS = [
  { icon: Target, title: 'Quality', body: 'We deliver excellence in every build, test, and release cycle.' },
  { icon: Users, title: 'Collaboration', body: 'We achieve more together — one team, one mission.' },
  { icon: Lightbulb, title: 'Innovation', body: 'We embrace change and bring new ideas to every challenge.' },
  { icon: Shield, title: 'Ownership', body: 'We take pride in our work and own outcomes end-to-end.' },
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
 * Public landing page. Fixed marketing copy renders as a server component
 * with no client JS of its own; identity (name, headline, tagline, logo) is
 * admin-customizable via /v1/branding, so the header/footer that read it are
 * split out into their own client islands (see LandingHeader/LandingFooter)
 * that fetch it and hydrate over the given defaults.
 */
export default function LandingPage() {
  return (
    <main className="landing">
      <LandingHeader defaultIdentity={DEFAULT_IDENTITY} />

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
                {idx < PIPELINE.length - 1 && (
                  <ChevronRight size={15} className="landing-pipeline-chevron" aria-hidden="true" />
                )}
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
          <p className="landing-eyebrow">Our foundation</p>
          <h2>Built on four pillars</h2>
          <p className="landing-pillars-sub">The values that drive every test case, every sprint, every release.</p>
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

      <LandingFooter defaultIdentity={DEFAULT_IDENTITY} />
    </main>
  );
}
