'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Eye, MoreVertical, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBuilderStore, type EditorTab } from '../lib/store';
import { CANVAS_WASH, GOOGLE_PURPLE } from '../lib/constants';
import { QuestionsPanel } from './questions-panel';
import { ResponsesTab } from './responses-tab';
import { PreviewDialog } from './preview-dialog';

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

const FONT_STACKS: Record<string, string> = {
  default: 'inherit',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  monospace: 'ui-monospace, Menlo, Consolas, monospace',
};

export function BuilderShell() {
  const activeTab = useBuilderStore((s) => s.activeTab);
  const setActiveTab = useBuilderStore((s) => s.setActiveTab);
  const title = useBuilderStore((s) => s.form.title);
  const theme = useBuilderStore((s) => s.form.theme);
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="min-h-screen" style={{ background: CANVAS_WASH }}>
      <header className="sticky top-0 z-40 flex justify-center border-b border-black/10 bg-white">
        <div className="flex h-16 w-full max-w-5xl items-center gap-3 px-4">
          <Link href="/form-builder" aria-label="Go to your forms">
            <AppMark />
          </Link>
          <span className="min-w-0 shrink-0 truncate text-[15px] font-medium text-[#202124]">
            {title || 'Untitled form'}
          </span>

          <Link
            href="/form-builder/edit"
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#dadce0] px-3 py-1.5 text-sm text-[#5f6368] hover:bg-[#f1f3f4]"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">New form</span>
          </Link>

          <div className="hidden flex-1 justify-center sm:flex">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)}>
              <TabsList variant="line">
                <TabsTrigger value="questions" className="px-4 text-[15px] data-[state=active]:text-[#673ab7]">
                  Questions
                </TabsTrigger>
                <TabsTrigger value="responses" className="px-4 text-[15px] data-[state=active]:text-[#673ab7]">
                  Responses
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-1 items-center justify-end gap-1 sm:flex-none">
            <Button type="button" variant="ghost" size="icon" className="rounded-full" title="Preview" aria-label="Preview" onClick={() => setPreviewOpen(true)}>
              <Eye className="size-5 text-[#5f6368]" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              title="More options"
              aria-label="More options"
              onClick={() => toast.info('Nothing here yet in this prototype.')}
            >
              <MoreVertical className="size-5 text-[#5f6368]" />
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b border-black/10 bg-white px-4 py-1 sm:hidden">
        <div className="flex justify-center">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)}>
            <TabsList variant="line">
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="responses">Responses</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex justify-center">
        <main
          className="w-full max-w-3xl px-4 py-8"
          style={activeTab === 'questions' ? { background: theme.backgroundColor, fontFamily: FONT_STACKS[theme.fontStyle] } : undefined}
        >
          {activeTab === 'questions' ? <QuestionsPanel /> : <ResponsesTab />}
        </main>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
