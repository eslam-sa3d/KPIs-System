import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { assetUrl } from '../../lib/api-client';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export function MultiSelectField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'multi_select' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const selected = (value as string[] | undefined) ?? [];
  const otherEntry = selected.find((v) => v.startsWith('other:'));
  return (
    <span className="check-group" id={id}>
      {field.options.map((o) => (
        <label key={o.value} className="check-item">
          <Checkbox
            checked={selected.includes(o.value)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
            }
          />
          {o.imageAssetId && <img src={assetUrl(o.imageAssetId)} alt="" className="option-image" loading="lazy" />}
          {o.label}
        </label>
      ))}
      {field.allowOther && (
        <label className="check-item">
          <Checkbox
            checked={otherEntry !== undefined}
            onCheckedChange={(checked) =>
              onChange(checked ? [...selected, 'other:'] : selected.filter((v) => !v.startsWith('other:')))
            }
          />
          Other:
          {otherEntry !== undefined && (
            <Input
              type="text"
              aria-label={`${field.label} other`}
              value={otherEntry.slice(6)}
              onChange={(e) => onChange(selected.map((v) => (v.startsWith('other:') ? `other:${e.target.value}` : v)))}
            />
          )}
        </label>
      )}
    </span>
  );
}
