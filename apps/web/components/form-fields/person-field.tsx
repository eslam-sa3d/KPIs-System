'use client';

import { useEffect, useState } from 'react';
import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { api } from '../../lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface UserOption {
  id: string;
  email: string;
  displayName: string;
}

export function PersonField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'person' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  // 'person' fields (the KPI-bridge evaluatee picker): live user search — fetched once per
  // field instance, not per-field-type-branch, to keep this a top-level hook (rules-of-hooks).
  const [userOptions, setUserOptions] = useState<UserOption[] | null>(null);
  const [personFilter, setPersonFilter] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<UserOption[]>('/v1/users?pageSize=200')
      .then((users) => {
        if (!cancelled) setUserOptions(users);
      })
      .catch(() => {
        if (!cancelled) setUserOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = value as string | undefined;
  const selectedUser = userOptions?.find((u) => u.id === current);
  const candidates = (userOptions ?? []).filter(
    (u) =>
      u.displayName.toLowerCase().includes(personFilter.toLowerCase()) ||
      u.email.toLowerCase().includes(personFilter.toLowerCase()),
  );
  return (
    <span id={id}>
      {selectedUser ? (
        <span className="check-item">
          {selectedUser.displayName} ({selectedUser.email}){' '}
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Change
          </Button>
        </span>
      ) : (
        <>
          <Input
            type="text"
            aria-label={`${field.label} search`}
            placeholder={userOptions === null ? 'Loading…' : 'Search by name or email'}
            value={personFilter}
            disabled={userOptions === null}
            onChange={(e) => setPersonFilter(e.target.value)}
          />
          {personFilter && candidates.length > 0 && (
            <div
              role="listbox"
              aria-label={`${field.label} matches`}
              className="max-h-48 overflow-y-auto rounded-md border"
            >
              {candidates.map((u) => (
                <Button
                  key={u.id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onChange(u.id);
                    setPersonFilter('');
                  }}
                  className="h-auto w-full justify-start rounded-none px-3 py-2 text-left text-sm font-normal"
                >
                  {u.displayName} ({u.email})
                </Button>
              ))}
            </div>
          )}
          {personFilter && candidates.length === 0 && userOptions !== null && <p className="muted">No matches</p>}
        </>
      )}
    </span>
  );
}
