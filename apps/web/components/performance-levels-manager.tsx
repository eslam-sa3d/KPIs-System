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

interface PerformanceLevelRow {
  id: string;
  label: string;
  minScore: number;
  maxScore: number;
}

function formatRange(level: PerformanceLevelRow): string {
  return `${level.minScore.toFixed(1)} – ${level.maxScore.toFixed(1)}`;
}

/** List, create, edit, and delete performance levels — the Configuration
 *  page's "performance levels" tab. Each level names a band of the 0-5
 *  EvaluationAreaEntry score range (e.g. 4.0-5.0 = "Outstanding"). */
export function PerformanceLevelsManager({ user }: { user: AuthenticatedUser | null }) {
  const [levels, setLevels] = useState<PerformanceLevelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = can(user, 'configuration:edit');
  const canDelete = can(user, 'configuration:delete');

  const reload = useCallback(() => api<PerformanceLevelRow[]>('/v1/performance-levels').then(setLevels), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/performance-levels', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          minScore: Number(form.get('minScore')),
          maxScore: Number(form.get('maxScore')),
        }),
      });
      (event.target as HTMLFormElement).reset();
      setNotice('performance level created');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the performance level failed');
    }
  }

  async function onUpdate(levelId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/v1/performance-levels/${levelId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: form.get('label'),
          minScore: Number(form.get('minScore')),
          maxScore: Number(form.get('maxScore')),
        }),
      });
      setEditingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the performance level failed');
    }
  }

  async function onDelete(levelId: string) {
    setError(null);
    try {
      await api(`/v1/performance-levels/${levelId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the performance level failed');
    }
  }

  return (
    <>
      <p className="muted">name the bands a 0–5 evaluation score falls into</p>

      {canEdit && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <Input
                name="minScore"
                type="number"
                min={0}
                max={5}
                step="0.1"
                required
                placeholder="from"
                aria-label="range start"
                style={{ maxWidth: '6rem' }}
              />
              <Input
                name="maxScore"
                type="number"
                min={0}
                max={5}
                step="0.1"
                required
                placeholder="to"
                aria-label="range end"
                style={{ maxWidth: '6rem' }}
              />
              <Input name="label" required minLength={2} placeholder="label, e.g. Outstanding" aria-label="label" />
              <Button type="submit">add level</Button>
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

      {levels === null ? (
        <LoadingState />
      ) : levels.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Gauge size={22} aria-hidden="true" />
          </span>
          <h2>no performance levels yet</h2>
          <p className="muted">add the first band above to start labeling evaluation scores.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>range</TableHead>
              <TableHead>label</TableHead>
              {(canEdit || canDelete) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {levels.map((level) =>
              editingId === level.id ? (
                <TableRow key={level.id}>
                  <TableCell colSpan={canEdit || canDelete ? 3 : 2}>
                    <form className="inline-form" onSubmit={(e) => onUpdate(level.id, e)}>
                      <Input
                        name="minScore"
                        type="number"
                        min={0}
                        max={5}
                        step="0.1"
                        required
                        defaultValue={level.minScore}
                        aria-label="range start"
                        style={{ maxWidth: '6rem' }}
                        autoFocus
                      />
                      <Input
                        name="maxScore"
                        type="number"
                        min={0}
                        max={5}
                        step="0.1"
                        required
                        defaultValue={level.maxScore}
                        aria-label="range end"
                        style={{ maxWidth: '6rem' }}
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
                  <TableCell className="tabular-nums">{formatRange(level)}</TableCell>
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
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => onDelete(level.id)}
                              >
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
