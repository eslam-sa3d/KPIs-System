'use client';

import { useEffect, useState } from 'react';
import type { ApiEnvelope, BrandIdentity } from '@pulse/contracts';
import { API_URL } from './api-client';

/** Public branding (name, headline, tagline, logo) is admin-customizable via
 *  /v1/branding — `defaultIdentity` renders instantly and the fetched
 *  identity hydrates over it once the request resolves. Client-only: this
 *  app is a static export, so the API isn't reachable at build time and the
 *  fetch has to happen in the browser rather than server-side. */
export function useBrandIdentity(defaultIdentity: BrandIdentity): BrandIdentity {
  const [identity, setIdentity] = useState(defaultIdentity);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/branding`)
      .then((res) => res.json() as Promise<ApiEnvelope<BrandIdentity>>)
      .then((envelope) => envelope.success && setIdentity(envelope.data))
      .catch(() => undefined); // keep defaults
  }, []);

  return identity;
}
