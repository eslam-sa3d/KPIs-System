'use client';

import { useRef } from 'react';
import { FileText, Image as ImageIcon, ListPlus, PlusCircle, SeparatorHorizontal, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBuilderStore } from '../lib/store';

/** Google Forms' vertical icon rail beside the focused question card. Reads
 *  its position from the DOM (rendered inside the active card, positioned
 *  `absolute left-full`) so it always tracks whichever card is active with
 *  no scroll-position math. */
export function FloatingToolbar({ sectionId, fieldId }: { sectionId: string; fieldId: string }) {
  const addField = useBuilderStore((s) => s.addField);
  const addTitleBlock = useBuilderStore((s) => s.addTitleBlock);
  const addSection = useBuilderStore((s) => s.addSection);
  const updateField = useBuilderStore((s) => s.updateField);
  const imageInputRef = useRef<HTMLInputElement>(null);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    updateField(fieldId, { media: { type: 'image', url: URL.createObjectURL(file) } });
  }

  const actions = [
    { icon: PlusCircle, label: 'Add question', onClick: () => addField(sectionId, fieldId, 'short_answer') },
    {
      icon: ListPlus,
      label: 'Import questions',
      onClick: () => toast.info('Importing questions is not wired up in this prototype module.'),
    },
    { icon: FileText, label: 'Add title and description', onClick: () => addTitleBlock(sectionId, fieldId) },
    { icon: ImageIcon, label: 'Add image', onClick: () => imageInputRef.current?.click() },
    {
      icon: Video,
      label: 'Add video',
      onClick: () => {
        const url = window.prompt('Paste a video embed URL (e.g. a YouTube link)');
        if (url) updateField(fieldId, { media: { type: 'video', url } });
      },
    },
    { icon: SeparatorHorizontal, label: 'Add section', onClick: () => addSection(sectionId) },
  ];

  return (
    <>
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      <div
        className="absolute left-full top-2 ml-3 hidden w-11 flex-col gap-1 rounded-xl border border-border bg-card p-1.5 shadow-md md:flex"
        role="menu"
        aria-label="Add to form"
      >
        {actions.map(({ icon: Icon, label, onClick }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon"
            title={label}
            aria-label={label}
            onClick={onClick}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3 md:hidden">
        {actions.map(({ icon: Icon, label, onClick }) => (
          <Button key={label} type="button" variant="ghost" size="sm" onClick={onClick}>
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>
    </>
  );
}
