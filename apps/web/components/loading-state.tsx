import { Spinner } from '@/components/ui/spinner';

/** Standard inline "spinner + label" loading row — swap-in replacement for
 *  the old bare `<p className="muted">loading…</p>` text across the app. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Spinner className="size-4" />
      {label}
    </p>
  );
}
