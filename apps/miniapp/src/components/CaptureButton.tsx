import { useRef, useState } from 'react';
import { compressPhoto, formatBytes } from '../lib/compress.js';

export interface CapturedPhoto {
  base64: string;
  mimeType: string;
  /** When the meal was eaten (local date input value, if the user picked one). */
  eatenAt?: string;
}

interface Props {
  busy?: boolean;
  onAnalyze: (photo: CapturedPhoto, file: Blob) => Promise<void>;
}

/** Today at the current local time, formatted for <input type="datetime-local">. */
function nowForInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Photo intake for the app: camera or library, compressed in the browser
 * before anything is sent, with an optional "eaten at" date.
 */
export function CaptureButton({ busy = false, onAnalyze }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // Defaults to "now"; the user can backdate this to when the meal happened.
  const [eatenAt, setEatenAt] = useState(() => nowForInput());
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      const photo = await compressPhoto(file);
      setSaved(`${formatBytes(file.size)} → ${formatBytes(photo.bytes)}`);
      await onAnalyze({ base64: photo.base64, mimeType: photo.mimeType, ...(eatenAt ? { eatenAt } : {}) }, file);
    } catch (err) {
      setError(
        err instanceof Error && /decode|bitmap/i.test(err.message)
          ? "That photo format can't be read here — try a JPEG, or take a new photo."
          : err instanceof Error
            ? err.message
            : 'Could not read that photo',
      );
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const disabled = busy || preparing;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex-1 rounded-xl bg-[var(--tg-theme-button-color,#3aa0ff)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color,#06121f)] disabled:opacity-60"
        >
          {preparing ? 'Preparing photo…' : busy ? 'Analyzing…' : 'Add a meal photo'}
        </button>
        <label className="flex flex-col text-[11px] text-[var(--tg-theme-hint-color,#9fb2c4)]">
          Eaten
          <input
            type="datetime-local"
            value={eatenAt}
            onChange={(e) => setEatenAt(e.target.value)}
            className="mt-0.5 rounded-lg border border-[var(--tg-theme-secondary-bg-color,#223140)] bg-transparent px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {saved && !error && (
        <p className="text-[11px] text-[var(--tg-theme-hint-color,#9fb2c4)]">Compressed {saved}</p>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
