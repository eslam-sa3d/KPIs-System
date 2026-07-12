'use client';

import { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, ListPlus, PlusCircle, SeparatorHorizontal, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/button';
import { useBuilderStore } from '../lib/store';
import { parseQaEvaluationDocx } from '../lib/import-docx';

/** Google Forms' vertical icon rail beside the focused question card. Reads
 *  its position from the DOM (rendered inside the active card, positioned
 *  `absolute left-full`) so it always tracks whichever card is active with
 *  no scroll-position math. */
export function FloatingToolbar({ sectionId, fieldId }: { sectionId: string; fieldId: string }) {
  const addField = useBuilderStore((s) => s.addField);
  const addTitleBlock = useBuilderStore((s) => s.addTitleBlock);
  const addSection = useBuilderStore((s) => s.addSection);
  const updateField = useBuilderStore((s) => s.updateField);
  const importSections = useBuilderStore((s) => s.importSections);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    updateField(fieldId, { media: { type: 'image', url: URL.createObjectURL(file) } });
  }

  async function onPickDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const { value: rawText } = await mammoth.extractRawText({ arrayBuffer });
      const { title, description, sections, issues } = parseQaEvaluationDocx(rawText);

      if (sections.length === 0) {
        toast.error(issues[0] ?? 'no numbered questions found in this file');
        return;
      }

      importSections(sections, title, description);
      const questionCount = sections.reduce((n, s) => n + s.fields.length, 0);
      toast.success(`Imported ${questionCount} question${questionCount === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}.`);
      if (issues.length > 0) toast.info(`${issues.length} line(s) couldn't be parsed and were skipped.`);
    } catch {
      toast.error('could not read this file — is it a valid .docx?');
    } finally {
      setImporting(false);
    }
  }

  const actions = [
    { icon: PlusCircle, label: 'Add question', onClick: () => addField(sectionId, fieldId, 'short_answer') },
    {
      icon: ListPlus,
      label: 'Import questions',
      onClick: () => docxInputRef.current?.click(),
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
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
      <input ref={docxInputRef} type="file" accept=".docx" style={{ display: 'none' }} onChange={onPickDocx} disabled={importing} />
      <div className="fb-toolbar-rail" role="menu" aria-label="Add to form">
        {actions.map(({ icon: Icon, label, onClick }) => (
          <IconButton
            key={label}
            icon={Icon}
            label={label}
            isDisabled={label === 'Import questions' && importing}
            onClick={onClick}
          />
        ))}
      </div>
      <div className="fb-toolbar-row">
        {actions.map(({ icon: Icon, label, onClick }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="sm"
            iconBefore={Icon}
            isDisabled={label === 'Import questions' && importing}
            onClick={onClick}
          >
            {label}
          </Button>
        ))}
      </div>
    </>
  );
}
