'use client';

import { BuilderShell } from './components/builder-shell';

/**
 * Standalone Google-Forms-parity prototype. Local state + mock data only —
 * not wired to @pulse/contracts or the API. See lib/types.ts for the schema.
 */
export default function FormBuilderPage() {
  return <BuilderShell />;
}
