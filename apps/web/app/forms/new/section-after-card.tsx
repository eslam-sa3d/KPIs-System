import { END_OF_FORM } from '@pulse/contracts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DraftSection } from './types';

/** "After this page, go to…" — a page's own branching fallback, used once
 *  none of its `select` fields' own optionGoTo redirected elsewhere.
 *  Rendered right after the question that ends a page. */
export function SectionAfterCard({
  section,
  laterSections,
  onUpdate,
}: {
  section: DraftSection;
  laterSections: Array<{ id: string; title: string }>;
  onUpdate: (patch: Partial<DraftSection>) => void;
}) {
  return (
    <div className="admin-card" style={{ marginTop: -8, marginBottom: 12 }}>
      <label htmlFor={`section-default-${section.id}`}>After this page, go to</label>
      <Select
        value={section.defaultGoTo || '__none__'}
        onValueChange={(v) => onUpdate({ defaultGoTo: v === '__none__' ? '' : v })}
      >
        <SelectTrigger id={`section-default-${section.id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Continue to the next page</SelectItem>
          {laterSections.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.title.trim() || t.id}
            </SelectItem>
          ))}
          <SelectItem value={END_OF_FORM}>Submit form</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
