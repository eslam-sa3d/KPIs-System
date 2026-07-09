import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'pulse — KPI management platform',
  description: 'the intelligence behind what can’t fail',
};

// Runs before first paint so a stored light/dark choice applies immediately —
// otherwise the page would flash the system-default theme, then jump to the
// stored one once components/theme-toggle.tsx's effect runs. Storage key
// ('pulse-theme') must stay in sync with that file.
const THEME_INIT_SCRIPT = `(function () {
  try {
    var t = localStorage.getItem('pulse-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
