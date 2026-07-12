import type { Metadata } from 'next';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'pulse — KPI management platform',
  description: 'the intelligence behind what can’t fail',
};

// Runs before first paint so a stored light/dark choice applies immediately —
// otherwise the page would flash the system-default theme, then jump to the
// stored one once components/theme-toggle.tsx's effect runs. Storage key
// ('pulse-theme') must stay in sync with that file. Sets both [data-theme]
// (drives packages/theme's M3 palette) and [data-color-mode] (the attribute
// @atlaskit/tokens' own theme CSS keys off — see atlaskit-scheme.css) so a
// stored explicit choice applies to both token systems identically; system
// mode leaves both unset and relies on each system's own
// prefers-color-scheme fallback.
const THEME_INIT_SCRIPT = `(function () {
  try {
    var t = localStorage.getItem('pulse-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-color-mode', t);
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
