import { Spinner } from '@/components/ui/spinner';

/** Standard inline "spinner + label" loading row — swap-in replacement for
 *  the old bare `<p className="muted">loading…</p>` text across the app. */
export function LoadingState({ label = 'loading…' }: { label?: string }) {
  return (
    <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Spinner size="small" />
      {label}
    </p>
  );
}
