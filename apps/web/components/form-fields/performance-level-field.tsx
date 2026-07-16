'use client';

import { useEffect, useState } from 'react';
import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { api } from '../../lib/api-client';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface PerformanceLevelOption {
  id: string;
  label: string;
}

export function PerformanceLevelField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'performance_level' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  // 'performance_level' fields: live band list from the Configuration page's
  // Performance Levels tab — same fetch-once-per-field-instance shape as 'person'.
  const [performanceLevelOptions, setPerformanceLevelOptions] = useState<PerformanceLevelOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<PerformanceLevelOption[]>('/v1/performance-levels')
      .then((levels) => {
        if (!cancelled) setPerformanceLevelOptions(levels);
      })
      .catch(() => {
        if (!cancelled) setPerformanceLevelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const raw = (value as string) ?? '';
  return (
    <RadioGroup id={id} value={raw} onValueChange={(v) => onChange(v)} className="check-group">
      {(performanceLevelOptions ?? []).map((level) => (
        <label key={level.id} className="check-item">
          <RadioGroupItem value={level.id} />
          {level.label}
        </label>
      ))}
      {performanceLevelOptions === null && <p className="muted">Loading…</p>}
      {performanceLevelOptions?.length === 0 && <p className="muted">No performance levels configured yet</p>}
    </RadioGroup>
  );
}
