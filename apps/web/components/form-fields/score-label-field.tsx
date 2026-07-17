'use client';

import { useEffect, useState } from 'react';
import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { api } from '../../lib/api-client';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface ScoreLabelOption {
  id: string;
  label: string;
}

export function ScoreLabelField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'score_label' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  // 'score_label' fields: live list from the Configuration page's Score
  // Labels tab — same fetch-once-per-field-instance shape as 'performance_level'.
  const [scoreLabelOptions, setScoreLabelOptions] = useState<ScoreLabelOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<ScoreLabelOption[]>('/v1/score-labels')
      .then((labels) => {
        if (!cancelled) setScoreLabelOptions(labels);
      })
      .catch(() => {
        if (!cancelled) setScoreLabelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const raw = (value as string) ?? '';
  return (
    <RadioGroup id={id} value={raw} onValueChange={(v) => onChange(v)} className="check-group">
      {(scoreLabelOptions ?? []).map((label) => (
        <label key={label.id} className="check-item">
          <RadioGroupItem value={label.id} />
          {label.label}
        </label>
      ))}
      {scoreLabelOptions === null && <p className="muted">Loading…</p>}
      {scoreLabelOptions?.length === 0 && <p className="muted">No score labels configured yet</p>}
    </RadioGroup>
  );
}
