import { ArrowDown, ArrowUp } from 'lucide-react';
import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { assetUrl } from '../../lib/api-client';
import { Button } from '@/components/ui/button';

export function RankingField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'ranking' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const order = (value as string[] | undefined) ?? field.options.map((o) => o.value);
  const labelOf = (v: string) => field.options.find((o) => o.value === v)?.label ?? v;
  const imageOf = (v: string) => field.options.find((o) => o.value === v)?.imageAssetId;
  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return (
    <ol className="ranking" id={id}>
      {order.map((v, i) => (
        <li key={v} className="ranking-item">
          <span>
            {i + 1}.{' '}
            {imageOf(v) && <img src={assetUrl(imageOf(v)!)} alt="" className="option-image" loading="lazy" />}
            {labelOf(v)}
          </span>
          <span className="ranking-controls">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${labelOf(v)} up`}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${labelOf(v)} down`}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={14} aria-hidden="true" />
            </Button>
          </span>
        </li>
      ))}
    </ol>
  );
}
