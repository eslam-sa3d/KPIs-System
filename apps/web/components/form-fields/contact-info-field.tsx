import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { Input } from '@/components/ui/input';

export function ContactInfoField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'contact_info' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const current = (value as Record<string, string> | undefined) ?? {};
  const set = (part: string, v: string) => onChange({ ...current, [part]: v });
  return (
    <div className="contact-info-grid" id={id}>
      <label htmlFor={`${id}-name`} className="muted">
        Name{field.requireName && ' *'}
      </label>
      <Input id={`${id}-name`} value={current.name ?? ''} onChange={(e) => set('name', e.target.value)} />
      <label htmlFor={`${id}-email`} className="muted">
        Email{field.requireEmail && ' *'}
      </label>
      <Input
        id={`${id}-email`}
        type="email"
        value={current.email ?? ''}
        onChange={(e) => set('email', e.target.value)}
      />
      <label htmlFor={`${id}-phone`} className="muted">
        Phone{field.requirePhone && ' *'}
      </label>
      <Input id={`${id}-phone`} type="tel" value={current.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
    </div>
  );
}
