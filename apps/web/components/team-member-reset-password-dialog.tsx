import { Dispatch, FormEvent, SetStateAction } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { UserRow } from './team-members-manager';

/** Admin sets the account's new password directly (same "temporary password,
 *  must change at next login" semantics as creating a user) — no email round
 *  trip, so this works for a deactivated account too. */
export function TeamMemberResetPasswordDialog({
  row,
  draft,
  setDraft,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  row: UserRow | null;
  draft: { newPassword: string; confirmPassword: string };
  setDraft: Dispatch<SetStateAction<{ newPassword: string; confirmPassword: string }>>;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a new password for {row.displayName}</DialogTitle>
        </DialogHeader>
        <form className="builder" onSubmit={onSubmit} aria-busy={busy}>
          <label htmlFor="reset-pw-new">New password</label>
          <Input
            id="reset-pw-new"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={draft.newPassword}
            onChange={(e) => setDraft((d) => ({ ...d, newPassword: e.target.value }))}
          />

          <label htmlFor="reset-pw-confirm">Confirm new password</label>
          <Input
            id="reset-pw-confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={draft.confirmPassword}
            onChange={(e) => setDraft((d) => ({ ...d, confirmPassword: e.target.value }))}
          />

          <p className="muted" style={{ fontSize: 11, margin: '2px 0 8px' }}>
            {row.displayName} will be asked to change this password the next time they sign in.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
