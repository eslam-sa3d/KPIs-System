'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState } from '@/components/loading-state';

interface UserOption {
  id: string;
  email: string;
  displayName: string;
}

interface CollaboratorRow {
  id: string;
  userId: string;
  canManage: boolean;
  canViewResponses: boolean;
  user: { id: string; displayName: string; email: string };
}

/** "Specific people" sharing + co-owners — an allow-list layered on top of the
 *  anonymous public link (ShareLinkPanel), which stays untouched either way. */
export function AccessControlPanel({
  formId,
  restricted,
  onRestrictedChange,
}: {
  formId: string;
  restricted: boolean;
  onRestrictedChange: (next: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorRow[] | null>(null);
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [filter, setFilter] = useState('');
  const [pickUserId, setPickUserId] = useState('');
  const [pickCanManage, setPickCanManage] = useState(false);
  const [pickCanViewResponses, setPickCanViewResponses] = useState(false);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!restricted) return;
    api<CollaboratorRow[]>(`/v1/forms/${formId}/collaborators`).then(setCollaborators);
    api<UserOption[]>('/v1/users?pageSize=200').then(setUsers);
  }, [formId, restricted]);

  async function toggleRestricted(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/restricted`, {
        method: 'POST',
        body: JSON.stringify({ restricted: next }),
      });
      onRestrictedChange(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!pickUserId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({ userId: pickUserId, canManage: pickCanManage, canViewResponses: pickCanViewResponses }),
      });
      setCollaborators(await api<CollaboratorRow[]>(`/v1/forms/${formId}/collaborators`));
      setPickUserId('');
      setPickCanManage(false);
      setPickCanViewResponses(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/forms/${formId}/collaborators/${userId}`, { method: 'DELETE' });
      setCollaborators((current) => current?.filter((c) => c.userId !== userId) ?? null);
      setConfirmRemoveUserId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setBusy(false);
    }
  }

  const invitedIds = new Set((collaborators ?? []).map((c) => c.userId));
  const candidates = (users ?? []).filter(
    (u) =>
      !invitedIds.has(u.id) &&
      (u.displayName.toLowerCase().includes(filter.toLowerCase()) ||
        u.email.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>access</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          by default, anyone signed in with the "view forms" permission can open this form. restricting it limits that
          to specific people — the public share link above is unaffected either way.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <label className="check-item">
          <input
            type="checkbox"
            checked={restricted}
            disabled={busy}
            onChange={(e) => toggleRestricted(e.target.checked)}
          />
          restrict to specific people
        </label>

        {restricted && (
          <>
            <label htmlFor="ac-filter">invite someone</label>
            <input
              id="ac-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPickUserId('');
              }}
              placeholder="search by name or email"
            />
            {filter && candidates.length > 0 && (
              <div role="listbox" aria-label="matching users" className="max-h-48 overflow-y-auto rounded-md border">
                {candidates.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={pickUserId === u.id}
                    onClick={() => setPickUserId(u.id)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {u.displayName} ({u.email})
                  </button>
                ))}
              </div>
            )}
            <span className="builder-required">
              <input
                id="ac-can-manage"
                type="checkbox"
                checked={pickCanManage}
                onChange={(e) => setPickCanManage(e.target.checked)}
              />
              <label htmlFor="ac-can-manage">co-owner (can also edit and manage this form)</label>
            </span>
            <span className="builder-required">
              <input
                id="ac-can-view-responses"
                type="checkbox"
                checked={pickCanViewResponses}
                disabled={pickCanManage}
                onChange={(e) => setPickCanViewResponses(e.target.checked)}
              />
              <label htmlFor="ac-can-view-responses">
                can view responses (without editing the form — implied by co-owner)
              </label>
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={!pickUserId || busy} onClick={invite}>
              invite
            </Button>

            <label>people with access</label>
            {collaborators === null ? (
              <LoadingState />
            ) : collaborators.length === 0 ? (
              <p className="muted">no one invited yet — only you and admins can open this form.</p>
            ) : (
              <ul className="summary-samples">
                {collaborators.map((c) => (
                  <li key={c.id}>
                    {c.user.displayName} ({c.user.email}){' '}
                    {c.canManage ? '· co-owner' : c.canViewResponses ? '· can view responses' : ''}{' '}
                    {confirmRemoveUserId === c.userId ? (
                      <>
                        <span className="muted">remove access?</span>{' '}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => remove(c.userId)}
                        >
                          confirm remove
                        </Button>{' '}
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemoveUserId(null)}>
                          cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmRemoveUserId(c.userId)}
                      >
                        remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
