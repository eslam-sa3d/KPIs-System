import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { assetUrl } from '../../lib/api-client';

export function HotSpotField({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: 'hot_spot' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
}) {
  const id = `f-${field.key}`;
  const current = value as string | undefined;
  return (
    <div className="hot-spot-frame" id={id}>
      <img src={assetUrl(field.imageAssetId)} alt="" className="hot-spot-image" loading="lazy" />
      {field.regions.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-label={r.label}
          aria-pressed={current === r.value}
          className={`hot-spot-region${current === r.value ? ' hot-spot-region-active' : ''}`}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
          onClick={() => onChange(r.value)}
        />
      ))}
    </div>
  );
}
