'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { Briefcase, Pencil } from 'lucide-react';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../lib/api-client';

interface JobTitleRow {
  id: string;
  label: string;
}

/** List, create, edit, and delete job titles — the Configuration page's
 *  "job titles" tab. Plain named list, no score range (unlike Performance
 *  Levels). */
export function JobTitlesManager({ user }: { user: AuthenticatedUser | null }) {
  const [jobTitles, setJobTitles] = useState<JobTitleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = can(user, 'configuration:edit');
  const canDelete = can(user, 'configuration:delete');

  const reload = useCallback(() => api<JobTitleRow[]>('/v1/job-titles').then(setJobTitles), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/job-titles', {
        method: 'POST',
        body: JSON.stringify({ label: form.get('label') }),
      });
      (event.target as HTMLFormElement).reset();
      setNotice('Job title created');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the job title failed');
    }
  }

  async function onUpdate(jobTitleId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/v1/job-titles/${jobTitleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: form.get('label') }),
      });
      setEditingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the job title failed');
    }
  }

  async function onDelete(jobTitleId: string) {
    setError(null);
    try {
      await api(`/v1/job-titles/${jobTitleId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the job title failed');
    }
  }

  return (
    <>
      <p className="muted">Name the job titles available across the org</p>

      {canEdit && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <Input
                name="label"
                required
                minLength={2}
                placeholder="Title, e.g. Software Engineer"
                aria-label="Label"
              />
              <Button type="submit">Add job title</Button>
            </form>
            {notice && (
              <Alert className="mt-4">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {jobTitles === null ? (
        <LoadingState />
      ) : jobTitles.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Briefcase size={22} aria-hidden="true" />
          </span>
          <h2>No job titles yet</h2>
          <p className="muted">Add the first title above to start building the list.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              {(canEdit || canDelete) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobTitles.map((jobTitle) =>
              editingId === jobTitle.id ? (
                <TableRow key={jobTitle.id}>
                  <TableCell colSpan={canEdit || canDelete ? 2 : 1}>
                    <form className="inline-form" onSubmit={(e) => onUpdate(jobTitle.id, e)}>
                      <Input
                        name="label"
                        required
                        minLength={2}
                        defaultValue={jobTitle.label}
                        aria-label="Label"
                        autoFocus
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        Save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={jobTitle.id}>
                  <TableCell>{jobTitle.label}</TableCell>
                  {(canEdit || canDelete) && (
                    <TableCell>
                      <span className="row-actions">
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${jobTitle.label}`}
                            onClick={() => setEditingId(jobTitle.id)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                        )}
                        {canDelete &&
                          (confirmDeleteId === jobTitle.id ? (
                            <>
                              <span className="muted">Delete?</span>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => onDelete(jobTitle.id)}
                              >
                                Confirm
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setConfirmDeleteId(jobTitle.id)}
                            >
                              Delete
                            </Button>
                          ))}
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </>
  );
}
