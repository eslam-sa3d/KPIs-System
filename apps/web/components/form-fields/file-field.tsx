'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { FormField, SubmissionAnswers } from '@pulse/contracts';
import { ApiRequestError, uploadFile } from '../../lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function FileField({
  field,
  value,
  onChange,
  uploadPath,
}: {
  field: Extract<FormField, { type: 'file' }>;
  value: SubmissionAnswers[string] | undefined;
  onChange: (value: SubmissionAnswers[string]) => void;
  uploadPath: string;
}) {
  const id = `f-${field.key}`;
  const [uploadState, setUploadState] = useState<{ busy: boolean; filename: string | null; error: string | null }>({
    busy: false,
    filename: null,
    error: null,
  });
  // multi-file (maxFiles>1): filenames for ids uploaded THIS session — reloading an
  // in-progress answer only shows ids, so older attachments fall back to a generic label
  const [attachedNames, setAttachedNames] = useState<Record<string, string>>({});

  const fileField: Extract<FormField, { type: 'file' }> = field;
  const multi = fileField.maxFiles > 1;

  function validate(file: File): string | null {
    if (!fileField.acceptedMimeTypes.includes(file.type)) {
      return `"${file.type || 'unknown type'}" is not accepted here`;
    }
    if (file.size > fileField.maxSizeMb * 1024 * 1024) {
      return `File exceeds the ${fileField.maxSizeMb}MB limit`;
    }
    return null;
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same filename after an error
    if (files.length === 0) return;

    const currentIds = multi ? ((value as string[] | undefined) ?? []) : [];
    if (multi && currentIds.length + files.length > fileField.maxFiles) {
      setUploadState({ busy: false, filename: null, error: `Up to ${fileField.maxFiles} files allowed` });
      return;
    }
    for (const file of files) {
      const problem = validate(file);
      if (problem) {
        setUploadState({ busy: false, filename: null, error: problem });
        return;
      }
    }

    setUploadState({ busy: true, filename: null, error: null });
    try {
      const uploaded = await Promise.all(
        files.map((file) => uploadFile<{ id: string; filename: string }>(`${uploadPath}/${fileField.key}`, file)),
      );
      if (multi) {
        setAttachedNames((names) => ({
          ...names,
          ...Object.fromEntries(uploaded.map((u) => [u.id, u.filename])),
        }));
        onChange([...currentIds, ...uploaded.map((u) => u.id)]);
        setUploadState({ busy: false, filename: null, error: null });
      } else {
        setUploadState({ busy: false, filename: uploaded[0]!.filename, error: null });
        onChange(uploaded[0]!.id);
      }
    } catch (cause) {
      const message = cause instanceof ApiRequestError ? cause.message : 'Upload failed';
      setUploadState({ busy: false, filename: null, error: message });
    }
  }

  if (multi) {
    const ids = (value as string[] | undefined) ?? [];
    return (
      <div id={id}>
        <Input
          type="file"
          multiple
          aria-label={fileField.label}
          accept={fileField.acceptedMimeTypes.join(',')}
          onChange={(e) => void onPick(e)}
          disabled={uploadState.busy || ids.length >= fileField.maxFiles}
        />
        <p className="muted">
          {ids.length} / {fileField.maxFiles} files
        </p>
        {ids.length > 0 && (
          <ul className="summary-samples">
            {ids.map((fileId) => (
              <li key={fileId}>
                {attachedNames[fileId] ?? 'File attached'}{' '}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(ids.filter((v) => v !== fileId))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {uploadState.busy && <p className="muted">Uploading…</p>}
        {uploadState.error && (
          <Alert variant="destructive">
            <AlertDescription>{uploadState.error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const attachedName = uploadState.filename ?? (value ? 'File attached' : null);
  return (
    <div id={id}>
      <Input
        type="file"
        aria-label={fileField.label}
        accept={fileField.acceptedMimeTypes.join(',')}
        onChange={(e) => void onPick(e)}
        disabled={uploadState.busy}
      />
      {uploadState.busy && <p className="muted">Uploading…</p>}
      {attachedName && !uploadState.busy && (
        <p className="muted file-attached">
          <CheckCircle2 size={14} aria-hidden="true" className="file-attached-icon" />
          {attachedName}
        </p>
      )}
      {uploadState.error && (
        <Alert variant="destructive">
          <AlertDescription>{uploadState.error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
