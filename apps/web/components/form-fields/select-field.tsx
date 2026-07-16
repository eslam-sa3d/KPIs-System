import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { assetUrl } from '../../lib/api-client';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function SelectField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'select' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const raw = (value as string) ?? '';
  const isOther = raw.startsWith('other:');
  if (field.layout === 'radio') {
    return (
      <RadioGroup id={id} value={isOther ? 'other:' : raw} onValueChange={(v) => onChange(v)} className="check-group">
        {field.options.map((o) => (
          <label key={o.value} className="check-item">
            <RadioGroupItem value={o.value} />
            {o.imageAssetId && <img src={assetUrl(o.imageAssetId)} alt="" className="option-image" loading="lazy" />}
            {o.label}
          </label>
        ))}
        {field.allowOther && (
          <label className="check-item">
            <RadioGroupItem value="other:" />
            Other:
            {isOther && (
              <Input
                type="text"
                aria-label={`${field.label} other`}
                value={raw.slice(6)}
                onChange={(e) => onChange(`other:${e.target.value}`)}
              />
            )}
          </label>
        )}
      </RadioGroup>
    );
  }
  return (
    <>
      <Select
        value={isOther ? '__other' : raw || undefined}
        onValueChange={(v) => onChange(v === '__other' ? 'other:' : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {field.allowOther && <SelectItem value="__other">other…</SelectItem>}
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          type="text"
          aria-label={`${field.label} other`}
          placeholder="Please specify"
          value={raw.slice(6)}
          onChange={(e) => onChange(`other:${e.target.value}`)}
        />
      )}
    </>
  );
}
