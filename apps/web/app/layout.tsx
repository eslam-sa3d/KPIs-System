import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'pulse — KPI management platform',
  description: 'the intelligence behind what can’t fail',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
