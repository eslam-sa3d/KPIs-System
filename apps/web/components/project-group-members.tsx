'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/loading-state';
import { UserMultiSelectCombobox, type UserPickerOption } from './user-multi-select-combobox';

/** Current membership + searchable add/remove control for one project group,
 *  expanded inline under its row in ProjectGroupsManager. Toggling a user in
 *  the combobox immediately adds/removes them — there's no separate "save". */
export function ProjectGroupMembers({ groupId, canEdit }: { groupId: string; canEdit: boolean }) {
  const [members, setMembers] = useState<UserPickerOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () => api<UserPickerOption[]>(`/v1/project-groups/${groupId}/members`).then(setMembers),
    [groupId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onToggle(user: UserPickerOption) {
    setError(null);
    const isMember = members?.some((m) => m.id === user.id) ?? false;
    try {
      if (isMember) {
        await api(`/v1/project-groups/${groupId}/members/${user.id}`, { method: 'DELETE' });
      } else {
        await api(`/v1/project-groups/${groupId}/members`, {
          method: 'POST',
          body: JSON.stringify({ userIds: [user.id] }),
        });
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating group membership failed');
    }
  }

  if (members === null) return <LoadingState />;

  return (
    <div className="p-filter-pills" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {members.length === 0 ? (
        <p className="muted">no members yet.</p>
      ) : (
        <span className="chip-row">
          {members.map((m) => (
            <Badge key={m.id} variant="secondary">
              {m.displayName}
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`remove ${m.displayName}`}
                  onClick={() => onToggle(m)}
                  className="ml-1 size-4"
                >
                  <X size={12} aria-hidden="true" />
                </Button>
              )}
            </Badge>
          ))}
        </span>
      )}
      {canEdit && (
        <UserMultiSelectCombobox
          selectedIds={new Set(members.map((m) => m.id))}
          onToggle={onToggle}
          triggerLabel="add / remove members"
        />
      )}
    </div>
  );
}
