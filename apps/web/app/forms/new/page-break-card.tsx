import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assetUrl } from '../../../lib/api-client';
import type { DraftSection } from './types';

/** Editing card for a page break — rendered right before the question that
 *  starts a page (see resolvedSections in use-form-builder.ts, which derives
 *  each page's field list purely from where its break sits). */
export function PageBreakCard({
  section,
  pageDisplayIndex,
  totalPages,
  onRemove,
  onUpdate,
  onUploadMedia,
}: {
  section: DraftSection;
  pageDisplayIndex: number;
  totalPages: number;
  onRemove: () => void;
  onUpdate: (patch: Partial<DraftSection>) => void;
  onUploadMedia: (file: File) => void;
}) {
  return (
    <div className="admin-card page-break-card" style={{ marginBottom: 12 }}>
      <div className="page-title-row" style={{ marginBottom: 8 }}>
        <span className="field-legend">
          Page {pageDisplayIndex + 1} of {totalPages}
        </span>
        {pageDisplayIndex > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Remove this page break"
            aria-label={`Remove page ${pageDisplayIndex + 1} — merges its questions into the previous page`}
            onClick={onRemove}
          >
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        )}
      </div>

      <label htmlFor={`section-title-${section.id}`}>Page title (optional)</label>
      <Input
        id={`section-title-${section.id}`}
        value={section.title}
        onChange={(e) => onUpdate({ title: e.target.value })}
        placeholder={section.id}
      />

      <label htmlFor={`section-description-${section.id}`}>Page description (optional)</label>
      <Input
        id={`section-description-${section.id}`}
        value={section.description}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder="Shown under the page title"
      />

      <label htmlFor={`section-media-type-${section.id}`}>Page media (optional)</label>
      <Select value={section.mediaType} onValueChange={(v) => onUpdate({ mediaType: v as DraftSection['mediaType'] })}>
        <SelectTrigger id={`section-media-type-${section.id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="image">Image</SelectItem>
          <SelectItem value="video">Video (embed URL)</SelectItem>
        </SelectContent>
      </Select>
      {section.mediaType === 'image' && (
        <>
          <Input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => e.target.files?.[0] && onUploadMedia(e.target.files[0])}
          />
          {section.mediaAssetId && <img src={assetUrl(section.mediaAssetId)} alt="" className="option-image" />}
        </>
      )}
      {section.mediaType === 'video' && (
        <Input
          value={section.mediaUrl}
          onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
          placeholder="https://www.youtube.com/embed/…"
        />
      )}
    </div>
  );
}
