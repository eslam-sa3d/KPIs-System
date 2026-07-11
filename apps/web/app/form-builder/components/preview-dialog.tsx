'use client';

import { useEffect, useState } from 'react';
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
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={o.value} /> {o.value}
            </label>
          ))}
          {field.allowOther && (
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="other:" /> Other:
              {isOther && <Input className="h-8 w-48" value={v.slice(6)} onChange={(e) => onChange(`other:${e.target.value}`)} />}
            </label>
          )}
        </RadioGroup>
      );
    }
    case 'checkboxes': {
      const selected = (value as string[]) ?? [];
      const other = selected.find((s) => s.startsWith('other:'));
      return (
        <div className="flex flex-col gap-2">
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={(c) => onChange(c ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
              />
              {o.value}
            </label>
          ))}
          {field.allowOther && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={other !== undefined}
                onCheckedChange={(c) => onChange(c ? [...selected, 'other:'] : selected.filter((v) => !v.startsWith('other:')))}
              />
              Other:
              {other !== undefined && (
                <Input
                  className="h-8 w-48"
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
          <SelectTrigger className="w-64"><SelectValue placeholder="Choose" /></SelectTrigger>
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
        <div className="flex items-center gap-3">
          {field.minLabel && <span className="text-xs text-muted-foreground">{field.minLabel}</span>}
          {scale.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex size-9 items-center justify-center rounded-full border text-sm ${
                current === n ? 'border-[#673ab7] bg-[#673ab7] text-white' : 'border-border text-foreground'
              }`}
            >
              {n}
            </button>
          ))}
          {field.maxLabel && <span className="text-xs text-muted-foreground">{field.maxLabel}</span>}
        </div>
      );
    }
    case 'multiple_choice_grid':
    case 'checkbox_grid': {
      const isMultiple = field.type === 'checkbox_grid';
      const current = (value as Record<string, string | string[]>) ?? {};
      return (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th />
                {field.columns.map((c) => (
                  <th key={c} className="px-3 pb-2 text-center font-normal text-muted-foreground">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => {
                const rowVal = current[row];
                const rowSelected = isMultiple ? ((rowVal as string[]) ?? []) : (rowVal as string | undefined);
                return (
                  <tr key={row} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{row}</td>
                    {field.columns.map((c) => (
                      <td key={c} className="px-3 text-center">
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
      return <Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-48" />;
    case 'time':
      return <Input type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-48" />;
    case 'file_upload':
      return <p className="text-sm text-muted-foreground">File upload isn&apos;t available in preview.</p>;
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" style={{ fontFamily: fontStack }}>
        <DialogTitle className="sr-only">Form preview</DialogTitle>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="h-2" style={{ background: form.theme.primaryColor }} aria-hidden />
          {form.theme.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview
            <img src={form.theme.headerImageUrl} alt="" className="h-32 w-full object-cover" />
          )}
          <div className="flex flex-col gap-1 p-5" style={{ background: form.theme.backgroundColor }}>
            <h2 className="text-2xl font-semibold">{form.title || 'Untitled form'}</h2>
            {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
          </div>
        </div>

        {section && (
          <div className="flex flex-col gap-5 py-2">
            {form.sections.length > 1 && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Section {sectionIndex + 1} of {form.sections.length}
                {section.title ? ` · ${section.title}` : ''}
              </p>
            )}
            {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}

            {section.fieldIds.map((id) => {
              const field = form.fields[id];
              if (!field) return null;
              if (field.type === 'title_block') {
                return (
                  <div key={id}>
                    <h3 className="text-lg font-medium">{field.title}</h3>
                    {field.description && <p className="text-sm text-muted-foreground">{field.description}</p>}
                  </div>
                );
              }
              return (
                <div key={id} className="flex flex-col gap-2">
                  <label className="flex items-center gap-1 text-sm font-medium">
                    {field.title || 'Untitled question'}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                  <PreviewField field={field} value={answers[id]} onChange={(v) => setAnswers((a) => ({ ...a, [id]: v }))} />
                </div>
              );
            })}

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" disabled={sectionIndex === 0} onClick={() => setSectionIndex((i) => i - 1)}>
                Back
              </Button>
              {isLast ? (
                <Button type="button" style={{ background: form.theme.primaryColor }} onClick={() => onOpenChange(false)}>
                  Submit (preview only)
                </Button>
              ) : (
                <Button type="button" style={{ background: form.theme.primaryColor }} onClick={() => setSectionIndex((i) => i + 1)}>
                  Next
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
