'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuilderStore } from '../lib/store';
import type { FormField } from '../lib/types';

const FONT_STACKS: Record<string, string> = {
  default: 'inherit',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  monospace: 'ui-monospace, Menlo, Consolas, monospace',
};

/** A local, never-persisted answer store — Google's own preview lets you
 *  click around without actually submitting anything either. */
function PreviewField({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'title_block':
      return null;
    case 'short_answer':
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'paragraph':
      return <Textarea rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'multiple_choice': {
      const v = (value as string) ?? '';
      const isOther = v.startsWith('other:');
      return (
        <RadioGroup value={isOther ? 'other:' : v} onValueChange={onChange}>
          {field.options.map((o) => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <RadioGroupItem value={o.value} /> {o.value}
            </label>
          ))}
          {field.allowOther && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <RadioGroupItem value="other:" /> Other:
              {isOther && (
                <Input style={{ height: 32, width: 192 }} value={v.slice(6)} onChange={(e) => onChange(`other:${e.target.value}`)} />
              )}
            </label>
          )}
        </RadioGroup>
      );
    }
    case 'checkboxes': {
      const selected = (value as string[]) ?? [];
      const other = selected.find((s) => s.startsWith('other:'));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {field.options.map((o) => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={(c) => onChange(c ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
              />
              {o.value}
            </label>
          ))}
          {field.allowOther && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <Checkbox
                checked={other !== undefined}
                onCheckedChange={(c) => onChange(c ? [...selected, 'other:'] : selected.filter((v) => !v.startsWith('other:')))}
              />
              Other:
              {other !== undefined && (
                <Input
                  style={{ height: 32, width: 192 }}
                  value={other.slice(6)}
                  onChange={(e) => onChange(selected.map((v) => (v.startsWith('other:') ? `other:${e.target.value}` : v)))}
                />
              )}
            </label>
          )}
        </div>
      );
    }
    case 'dropdown':
      return (
        <Select value={(value as string) ?? undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.id} value={o.value}>{o.value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'linear_scale': {
      const current = value as number | undefined;
      const scale = Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {field.minLabel && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{field.minLabel}</span>}
          {scale.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              style={{
                display: 'flex',
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                fontSize: '0.875rem',
                border: current === n ? '1px solid #673ab7' : '1px solid var(--color-border)',
                background: current === n ? '#673ab7' : 'transparent',
                color: current === n ? 'white' : 'var(--color-text)',
              }}
            >
              {n}
            </button>
          ))}
          {field.maxLabel && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{field.maxLabel}</span>}
        </div>
      );
    }
    case 'multiple_choice_grid':
    case 'checkbox_grid': {
      const isMultiple = field.type === 'checkbox_grid';
      const current = (value as Record<string, string | string[]>) ?? {};
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th />
                {field.columns.map((c) => (
                  <th key={c} style={{ padding: '0 12px 8px', textAlign: 'center', fontWeight: 400, color: 'var(--color-text-muted)' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => {
                const rowVal = current[row];
                const rowSelected = isMultiple ? ((rowVal as string[]) ?? []) : (rowVal as string | undefined);
                return (
                  <tr key={row} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 16px 8px 0', fontWeight: 500 }}>{row}</td>
                    {field.columns.map((c) => (
                      <td key={c} style={{ padding: '0 12px', textAlign: 'center' }}>
                        <input
                          type={isMultiple ? 'checkbox' : 'radio'}
                          name={isMultiple ? undefined : `preview-${field.id}-${row}`}
                          checked={isMultiple ? (rowSelected as string[]).includes(c) : rowSelected === c}
                          onChange={(e) => {
                            if (isMultiple) {
                              const list = (rowSelected as string[]) ?? [];
                              onChange({ ...current, [row]: e.target.checked ? [...list, c] : list.filter((v) => v !== c) });
                            } else {
                              onChange({ ...current, [row]: c });
                            }
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    case 'date':
      return <Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} style={{ width: 192 }} />;
    case 'time':
      return <Input type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} style={{ width: 192 }} />;
    case 'file_upload':
      return (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>File upload isn&apos;t available in preview.</p>
      );
  }
}

export function PreviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const form = useBuilderStore((s) => s.form);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (open) {
      setSectionIndex(0);
      setAnswers({});
    }
  }, [open]);

  const section = form.sections[sectionIndex];
  const isLast = sectionIndex === form.sections.length - 1;
  const fontStack = FONT_STACKS[form.theme.fontStyle];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="large">
        <div
          data-theme="light"
          data-color-mode="light"
          style={{ maxHeight: '85vh', overflowY: 'auto', fontFamily: fontStack }}
        >
        <DialogTitle>Form preview</DialogTitle>
        <div style={{ overflow: 'hidden', borderRadius: 12, border: '1px solid var(--color-border)' }}>
          <div style={{ height: 8, background: form.theme.primaryColor }} aria-hidden />
          {form.theme.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview
            <img src={form.theme.headerImageUrl} alt="" style={{ height: 128, width: '100%', objectFit: 'cover' }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 20, background: form.theme.backgroundColor }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{form.title || 'Untitled form'}</h2>
            {form.description && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{form.description}</p>}
          </div>
        </div>

        {section && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 0' }}>
            {form.sections.length > 1 && (
              <p style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                Section {sectionIndex + 1} of {form.sections.length}
                {section.title ? ` · ${section.title}` : ''}
              </p>
            )}
            {section.description && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{section.description}</p>}

            {section.fieldIds.map((id) => {
              const field = form.fields[id];
              if (!field) return null;
              if (field.type === 'title_block') {
                return (
                  <div key={id}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 500 }}>{field.title}</h3>
                    {field.description && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{field.description}</p>}
                  </div>
                );
              }
              return (
                <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.875rem', fontWeight: 500 }}>
                    {field.title || 'Untitled question'}
                    {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                  </label>
                  {field.description && <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{field.description}</p>}
                  <PreviewField field={field} value={answers[id]} onChange={(v) => setAnswers((a) => ({ ...a, [id]: v }))} />
                </div>
              );
            })}

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
              <Button type="button" variant="outline" isDisabled={sectionIndex === 0} onClick={() => setSectionIndex((i) => i - 1)}>
                Back
              </Button>
              {/* form.theme.primaryColor is per-form, not a fixed Atlaskit appearance —
                  override the brand token locally rather than styling the Button directly
                  (Atlaskit's Button doesn't accept style/className). */}
              <span style={{ '--ds-background-brand-bold': form.theme.primaryColor } as CSSProperties}>
                {isLast ? (
                  <Button type="button" onClick={() => onOpenChange(false)}>
                    Submit (preview only)
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setSectionIndex((i) => i + 1)}>
                    Next
                  </Button>
                )}
              </span>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
