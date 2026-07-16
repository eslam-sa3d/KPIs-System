'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pulse-theme';
const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Cycles light → dark → auto (system preference). The actual light/dark M3
 *  token values already exist for every component (see m3-scheme.css) — this
 *  is just the missing control to reach them. A blocking inline script in
 *  layout.tsx applies the stored choice before first paint, so there's no
 *  flash of the wrong theme; this component only owns the control itself. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setTheme(stored);
    }
  }, []);

  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    applyTheme(next);
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }

  const label = theme === 'system' ? 'Auto' : theme;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full"
      onClick={cycle}
      aria-label={`Theme: ${label} — click to change`}
    >
      {label}
    </Button>
  );
}
