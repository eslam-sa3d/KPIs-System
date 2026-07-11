'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBuilderStore, type EditorTab } from '../lib/store';
import { QuestionsPanel } from './questions-panel';
import { ResponsesTab } from './responses-tab';

export function BuilderShell() {
  const activeTab = useBuilderStore((s) => s.activeTab);
  const setActiveTab = useBuilderStore((s) => s.setActiveTab);
  const title = useBuilderStore((s) => s.form.title);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back">
            <ArrowLeft className="size-4" />
          </Link>
          <span className="min-w-0 flex-1 truncate font-medium">{title || 'Untitled form'}</span>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)}>
            <TabsList>
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="responses">Responses</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {activeTab === 'questions' ? <QuestionsPanel /> : <ResponsesTab />}
      </main>
    </div>
  );
}
