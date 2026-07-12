'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Eye, MoreVertical, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { IconButton } from '@/components/ui/button';
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
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden style={{ flexShrink: 0 }}>
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
    <div style={{ minHeight: '100vh', background: activeTab === 'questions' ? CANVAS_WASH : 'var(--color-bg)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          justifyContent: 'center',
          borderBottom: '1px solid rgb(0 0 0 / 0.1)',
          background: 'white',
        }}
      >
        <div style={{ display: 'flex', height: 64, width: '100%', maxWidth: '64rem', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <Link href="/form-builder" aria-label="Go to your forms">
            <AppMark />
          </Link>
          <span
            style={{
              minWidth: 0,
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 15,
              fontWeight: 500,
              color: '#202124',
            }}
          >
            {title || 'Untitled form'}
          </span>

          <Link
            href="/form-builder/edit"
            target="_blank"
            rel="noopener noreferrer"
            className="fb-new-form-link"
          >
            <Plus size={16} />
            <span className="fb-new-form-label">New form</span>
          </Link>

          <div className="fb-desktop-tabs">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)}>
              <TabsList variant="line">
                <TabsTrigger value="questions">Questions</TabsTrigger>
                <TabsTrigger value="responses">Responses</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="fb-header-actions">
            <IconButton icon={Eye} label="Preview" onClick={() => setPreviewOpen(true)} />
            <IconButton
              icon={MoreVertical}
              label="More options"
              onClick={() => toast.info('Nothing here yet in this prototype.')}
            />
          </div>
        </div>
      </header>

      <div className="fb-mobile-tabbar">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)}>
            <TabsList variant="line">
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="responses">Responses</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <main
          data-theme={activeTab === 'questions' ? 'light' : undefined}
          data-color-mode={activeTab === 'questions' ? 'light' : undefined}
          style={{
            width: '100%',
            maxWidth: '48rem',
            padding: '32px 16px',
            ...(activeTab === 'questions' ? { background: theme.backgroundColor, fontFamily: FONT_STACKS[theme.fontStyle] } : undefined),
          }}
        >
          {activeTab === 'questions' ? <QuestionsPanel /> : <ResponsesTab />}
        </main>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
