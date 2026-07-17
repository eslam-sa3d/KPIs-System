'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { Gauge, Pencil } from 'lucide-react';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../lib/api-client';

interface ScoreLabelRow {
  id: string;
  label: string;
  score: number;
}

/** List, create, edit, and delete score labels — the Configuration page's
 *  "score labels" tab. Each label names a single point on the 0-5
 *  EvaluationAreaEntry score scale (e.g. 5 = "Outstanding"). */
export function ScoreLabelsManager({ user }: { user: AuthenticatedUser | null }) {
  const [labels, setLabels] = useState<ScoreLabelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = can(user, 'configuration:edit');
  const canDelete = can(user, 'configuration:delete');

  const reload = useCallback(() => api<ScoreLabelRow[]>('/v1/score-labels').then(setLabels), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/score-labels', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          score: Number(form.get('score')),
        }),
      });
      (event.target as HTMLFormElement).reset();
      setNotice('score label created');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the score label failed');
    }
  }

  async function onUpdate(labelId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/v1/score-labels/${labelId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: form.get('label'),
          score: Number(form.get('score')),
        }),
      });
      setEditingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the score label failed');
    }
  }

  async function onDelete(labelId: string) {
    setError(null);
    try {
      await api(`/v1/score-labels/${labelId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the score label failed');
    }
  }

  return (
    <>
      <p className="muted">name the points on the 0–5 evaluation score scale</p>

      {canEdit && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <Input
                name="score"
                type="number"
                min={0}
                max={5}
                step={1}
                required
                placeholder="score"
                aria-label="score"
                style={{ maxWidth: '6rem' }}
              />
              <Input name="label" required minLength={2} placeholder="label, e.g. Outstanding" aria-label="label" />
              <Button type="submit">add label</Button>
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

      {labels === null ? (
        <LoadingState />
      ) : labels.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Gauge size={22} aria-hidden="true" />
          </span>
          <h2>no score labels yet</h2>
          <p className="muted">add the first one above to start labeling evaluation scores.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>score</TableHead>
              <TableHead>label</TableHead>
              {(canEdit || canDelete) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels.map((level) =>
              editingId === level.id ? (
                <TableRow key={level.id}>
                  <TableCell colSpan={canEdit || canDelete ? 3 : 2}>
                    <form className="inline-form" onSubmit={(e) => onUpdate(level.id, e)}>
                      <Input
                        name="score"
                        type="number"
                        min={0}
                        max={5}
                        step={1}
                        required
                        defaultValue={level.score}
                        aria-label="score"
                        style={{ maxWidth: '6rem' }}
                        autoFocus
                      />
                      <Input name="label" required minLength={2} defaultValue={level.label} aria-label="label" />
                      <Button type="submit" variant="ghost" size="sm">
                        save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        cancel
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={level.id}>
                  <TableCell className="tabular-nums">{level.score}</TableCell>
                  <TableCell>{level.label}</TableCell>
                  {(canEdit || canDelete) && (
                    <TableCell>
                      <span className="row-actions">
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`edit ${level.label}`}
                            onClick={() => setEditingId(level.id)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                        )}
                        {canDelete &&
                          (confirmDeleteId === level.id ? (
                            <>
                              <span className="muted">delete?</span>
                              <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(level.id)}>
                                confirm
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                                cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setConfirmDeleteId(level.id)}
                            >
                              delete
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
