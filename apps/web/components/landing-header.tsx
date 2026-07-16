'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { BrandIdentity } from '@pulse/contracts';
import { Button } from '@/components/ui/button';
import { useBrandIdentity } from '../lib/use-brand-identity';
import { asset } from '../lib/asset';

/** The landing page's only identity-dependent piece above the fold — kept as
 *  its own client island so the rest of the (fixed marketing copy) page can
 *  render as a server component with no client JS of its own. */
export function LandingHeader({ defaultIdentity }: { defaultIdentity: BrandIdentity }) {
  const identity = useBrandIdentity(defaultIdentity);
  const logo = identity.logoUrl || asset('/brand/pulse-neg.svg');

  return (
    <header className="landing-header" data-surface="purple">
      <Image src={logo} alt={identity.companyName} width={128} height={56} priority unoptimized />
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </header>
  );
}
