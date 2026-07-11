'use client';

import { Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBuilderStore } from '../lib/store';
import { FORM_FONT_STYLES } from '../lib/types';

const FONT_STYLE_LABELS: Record<(typeof FORM_FONT_STYLES)[number], string> = {
  default: 'Default (sans-serif)',
  serif: 'Serif',
  monospace: 'Monospace',
};

export function ThemePanel() {
  const theme = useBuilderStore((s) => s.form.theme);
  const setTheme = useBuilderStore((s) => s.setTheme);

  function onPickHeaderImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTheme({ headerImageUrl: URL.createObjectURL(file) });
  }

  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
        <span
          className="size-4 rounded-full border border-border"
          style={{ background: theme.primaryColor }}
          aria-hidden
        />
        Theme
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">click to customize</span>
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Header image</Label>
          {theme.headerImageUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-picked object URL preview */}
              <img src={theme.headerImageUrl} alt="" className="h-28 w-full rounded-lg border border-border object-cover" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 bg-card/90"
                aria-label="Remove header image"
                onClick={() => setTheme({ headerImageUrl: null })}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40">
              <ImageIcon className="size-4" />
              Upload a header image
              <input type="file" accept="image/*" className="hidden" onChange={onPickHeaderImage} />
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-6">
          <div>
            <Label htmlFor="fb-primary-color" className="mb-1 block text-xs text-muted-foreground">
              Primary color
            </Label>
            <input
              id="fb-primary-color"
              type="color"
              value={theme.primaryColor}
              onChange={(e) => setTheme({ primaryColor: e.target.value })}
              className="h-9 w-16 cursor-pointer rounded border border-border bg-transparent"
            />
          </div>
          <div>
            <Label htmlFor="fb-bg-color" className="mb-1 block text-xs text-muted-foreground">
              Background shade
            </Label>
            <input
              id="fb-bg-color"
              type="color"
              value={theme.backgroundColor}
              onChange={(e) => setTheme({ backgroundColor: e.target.value })}
              className="h-9 w-16 cursor-pointer rounded border border-border bg-transparent"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Font style</Label>
            <Select value={theme.fontStyle} onValueChange={(v) => setTheme({ fontStyle: v as typeof theme.fontStyle })}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_FONT_STYLES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FONT_STYLE_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </details>
  );
}
