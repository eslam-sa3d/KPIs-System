'use client';

import Image from 'next/image';
import type { BrandIdentity } from '@pulse/contracts';
import { useBrandIdentity } from '../lib/use-brand-identity';
import { asset } from '../lib/asset';

/** Client island for the footer's identity-dependent alt text/company name —
 *  see LandingHeader for why this is split out of the (server-rendered)
 *  landing page rather than fetched inline. */
export function LandingFooter({ defaultIdentity }: { defaultIdentity: BrandIdentity }) {
  const identity = useBrandIdentity(defaultIdentity);

  return (
    <footer className="landing-footer">
      <Image src={asset('/brand/pulse-neg.svg')} alt={identity.companyName} width={96} height={42} unoptimized />
      <span className="muted">
        © {new Date().getFullYear()} {identity.companyName}
      </span>
    </footer>
  );
}
