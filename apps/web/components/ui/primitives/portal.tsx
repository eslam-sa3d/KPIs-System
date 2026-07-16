'use client';

import { createPortal } from 'react-dom';

/** Renders children into `document.body`, replacing Radix's `*.Portal`.
 *
 * Mounts synchronously (no effect-gated "mounted" state) — every consumer
 * already only renders a `<Portal>` while `open` is true, which can only
 * happen after a client-side interaction, so `document` is always available.
 * A deferred mount would leave `contentRef.current` null on the same commit
 * the owning component's layout effects (positioning, focus trap) run,
 * silently breaking anchored positioning and focus handling. */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
