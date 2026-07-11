'use client';

import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { GOOGLE_PURPLE } from './lib/constants';
import { MOCK_FORMS_LIST } from './lib/mock-forms-list';

/** A generic document-with-a-checkmark glyph standing in for a "Forms" app
 *  icon — deliberately not a reproduction of Google's own logo. */
function AppMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <rect x="2" y="2" width="24" height="24" rx="6" fill={GOOGLE_PURPLE} />
      <path d="M8 14.5l3.5 3.5L20 9" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * Standalone Google-Forms-parity prototype's home screen — a list of forms,
 * the same way forms.google.com opens on a grid of your recent forms rather
 * than straight into an editor. Every card below is dummy data (see
 * lib/mock-forms-list.ts); clicking one, or "Blank", opens the one mock form
 * this prototype actually edits at /form-builder/edit.
 */
export default function FormBuilderHomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="flex justify-center border-b border-black/10">
        <div className="flex h-16 w-full max-w-5xl items-center gap-3 px-4">
          <AppMark />
          <span className="text-[20px] text-[#5f6368]">Forms</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <section>
          <h2 className="mb-4 text-sm font-medium text-[#202124]">Start a new form</h2>
          <Link
            href="/form-builder/edit"
            className="flex h-40 w-36 flex-col items-center justify-center gap-2 rounded-lg border border-[#dadce0] hover:shadow-md"
          >
            <Plus className="size-8 text-[#673ab7]" />
            <span className="text-sm text-[#5f6368]">Blank</span>
          </Link>
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-sm font-medium text-[#202124]">Recent forms</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {MOCK_FORMS_LIST.map((item) => (
              <Link
                key={item.id}
                href="/form-builder/edit"
                className="overflow-hidden rounded-lg border border-[#dadce0] hover:shadow-md"
              >
                <div className="flex h-24 items-center justify-center" style={{ background: `${item.color}1a` }}>
                  <FileText className="size-8" style={{ color: item.color }} />
                </div>
                <div className="border-t border-[#dadce0] px-3 py-2">
                  <p className="truncate text-sm text-[#202124]">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-[#5f6368]">
                    {item.editedLabel} · {item.responseCount === 0 ? 'No responses' : `${item.responseCount} responses`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
