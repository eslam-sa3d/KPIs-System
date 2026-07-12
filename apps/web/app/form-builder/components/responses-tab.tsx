'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MOCK_SUBMISSIONS } from '../lib/mock-data';
import { summarizeForm, type FieldSummary } from '../lib/summarize';
import { useBuilderStore } from '../lib/store';
import { BarBreakdown, GridMatrix, PieBreakdown, ScaleBreakdown, TextSamples } from './charts';

function SummaryCard({ summary }: { summary: FieldSummary }) {
  const { field } = summary;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: 16, boxShadow: 'var(--shadow-card)' }}>
      <div>
        <h3 style={{ fontWeight: 500 }}>{field.title || 'Untitled question'}</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{summary.answered} response(s)</p>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: 16, boxShadow: 'var(--shadow-card)' }}>
        <p style={{ fontSize: '1.875rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{MOCK_SUBMISSIONS.length}</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>total responses (mock data)</p>
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

  if (!submission) return <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No responses yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: 16, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          Response {index + 1} of {MOCK_SUBMISSIONS.length} · {new Date(submission.submittedAt).toLocaleString()}
        </p>
        <div style={{ display: 'flex', gap: 4 }}>
          <IconButton
            icon={ChevronLeft}
            label="Previous response"
            isDisabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          />
          <IconButton
            icon={ChevronRight}
            label="Next response"
            isDisabled={index === MOCK_SUBMISSIONS.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          />
        </div>
      </div>

      <dl style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map((field, i) => (
          <div
            key={field!.id}
            style={i === fields.length - 1 ? { paddingBottom: 8 } : { borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}
          >
            <dt style={{ fontSize: '0.875rem', fontWeight: 500 }}>{field!.title || 'Untitled question'}</dt>
            <dd style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{formatAnswer(submission.answers[field!.id])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ResponsesTab() {
  return (
    <Tabs defaultValue="summary" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
