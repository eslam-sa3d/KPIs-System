'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MOCK_SUBMISSIONS } from '../lib/mock-data';
import { summarizeForm, type FieldSummary } from '../lib/summarize';
import { useBuilderStore } from '../lib/store';
import { BarBreakdown, GridMatrix, PieBreakdown, ScaleBreakdown, TextSamples } from './charts';

function SummaryCard({ summary }: { summary: FieldSummary }) {
  const { field } = summary;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div>
        <h3 className="font-medium">{field.title || 'Untitled question'}</h3>
        <p className="text-xs text-muted-foreground">{summary.answered} response(s)</p>
      </div>

      {(field.type === 'multiple_choice' || field.type === 'dropdown') && summary.counts && (
        <PieBreakdown counts={summary.counts} />
      )}
      {field.type === 'checkboxes' && summary.counts && <BarBreakdown counts={summary.counts} />}
      {field.type === 'linear_scale' && summary.scaleCounts && (
        <ScaleBreakdown scaleCounts={summary.scaleCounts} average={summary.average} min={field.min} max={field.max} />
      )}
      {(field.type === 'multiple_choice_grid' || field.type === 'checkbox_grid') && summary.matrix && (
        <GridMatrix matrix={summary.matrix} />
      )}
      {(field.type === 'short_answer' || field.type === 'paragraph') && (
        <TextSamples samples={summary.samples ?? []} />
      )}
      {(field.type === 'date' || field.type === 'time' || field.type === 'file_upload') && (
        <TextSamples samples={summary.samples ?? []} />
      )}
    </div>
  );
}

function SummaryView() {
  const form = useBuilderStore((s) => s.form);
  const summaries = useMemo(() => summarizeForm(form, MOCK_SUBMISSIONS), [form]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-3xl font-semibold tabular-nums">{MOCK_SUBMISSIONS.length}</p>
        <p className="text-sm text-muted-foreground">total responses (mock data)</p>
      </div>
      {summaries.map((summary) => (
        <SummaryCard key={summary.field.id} summary={summary} />
      ))}
    </div>
  );
}

function formatAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`).join(' · ');
  }
  return String(value);
}

function IndividualView() {
  const form = useBuilderStore((s) => s.form);
  const [index, setIndex] = useState(0);
  const submission = MOCK_SUBMISSIONS[index];
  const fields = form.sections.flatMap((s) => s.fieldIds).map((id) => form.fields[id]).filter((f) => f && f.type !== 'title_block');

  if (!submission) return <p className="text-sm text-muted-foreground">No responses yet.</p>;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Response {index + 1} of {MOCK_SUBMISSIONS.length} · {new Date(submission.submittedAt).toLocaleString()}
        </p>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label="Previous response" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next response"
            disabled={index === MOCK_SUBMISSIONS.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        {fields.map((field) => (
          <div key={field!.id} className="border-b border-border pb-2 last:border-0">
            <dt className="text-sm font-medium">{field!.title || 'Untitled question'}</dt>
            <dd className="text-sm text-muted-foreground">{formatAnswer(submission.answers[field!.id])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ResponsesTab() {
  return (
    <Tabs defaultValue="summary" className="gap-4">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="individual">Individual</TabsTrigger>
      </TabsList>
      <TabsContent value="summary">
        <SummaryView />
      </TabsContent>
      <TabsContent value="individual">
        <IndividualView />
      </TabsContent>
    </Tabs>
  );
}
