import Image from 'next/image';
import Link from 'next/link';

/**
 * Public landing page (SSR, CDN-cacheable).
 * Brand identity (logo, headline strings) is served from BrandSetting via the
 * API so admins can rebrand without a deployment; these are the defaults.
 */
export default function LandingPage() {
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
        <Image src="/brand/pulse-neg.svg" alt="pulse by solutions" width={140} height={61} priority />
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
          elevating what matters
        </h1>
        <p
          style={{
            marginTop: 'var(--space-4)',
            fontSize: 'var(--font-size-lg)',
            color: 'var(--color-text-muted)',
            maxWidth: 560,
          }}
        >
          the intelligence behind what can’t fail — define KPIs, collect data with
          custom forms, and see performance the moment it moves.
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
