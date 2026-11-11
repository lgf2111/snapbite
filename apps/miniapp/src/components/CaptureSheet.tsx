import type { MealResult } from '@snapbite/core';
import { useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { compressPhoto } from '../lib/compress.js';
import type { Backend } from '../lib/backend.js';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'analysing' | 'review' | 'saving' | 'error';

interface Props {
  backend: Backend;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: (result: MealResult) => void;
  onToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}

/**
 * Photo capture, as a state machine rather than one gesture.
 *
 * The old path called /analyze and POST /meals back to back, so a failure in the
 * second call threw the analysis away behind a toast, and nothing survived the
 * app being backgrounded. Here the analysis is held in state while the person
 * looks at it; saving is a separate, retryable step, and a failed save keeps the
 * draft on screen instead of closing.
 *
 *   idle → analysing → review → saving → closed
 *                    ↘ error → (retry reuses the same photo)
 */
export function CaptureSheet({ backend, open, onOpenChange, onLogged, onToast }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [draft, setDraft] = useState<MealResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photo = useRef<{ base64: string; mimeType: string } | null>(null);
  const preview = useRef<string | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const libraryInput = useRef<HTMLInputElement | null>(null);

  function reset() {
    setStage('idle');
    setDraft(null);
    setError(null);
    photo.current = null;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = null;
  }

  async function handleFile(file: File | undefined) {
    if (!file) {
      onOpenChange(false);
      return;
    }
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = URL.createObjectURL(file);
    setStage('analysing');
    setError(null);
    try {
      const compressed = await compressPhoto(file);
      photo.current = { base64: compressed.base64, mimeType: compressed.mimeType };
      const result = await backend.analyze(compressed.base64, compressed.mimeType);
      setDraft(result);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo');
      setStage('error');
    }
  }

  async function save() {
    if (!draft || !photo.current) return;
    setStage('saving');
    setError(null);
    try {
      await backend.logWithPhoto(draft, photo.current);
      onLogged(draft);
      toastDone(draft);
      onOpenChange(false);
      reset();
    } catch (err) {
      // Keep the draft: a retry must not re-run the AI call.
      setError(err instanceof Error ? err.message : 'Could not save that meal');
      setStage('error');
    }
  }

  function toastDone(result: MealResult) {
    onToast('success', `Logged ${Math.round(result.total.energyKcal)} kcal`);
  }

  const busy = stage === 'analysing' || stage === 'saving';

  return (
    <>
      {/* `capture` forces the camera; without it iOS offers the photo library.
          Two inputs are the only way to offer both from one sheet. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-save would hide a failure the person needs to see.
          if (!next && stage === 'saving') return;
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <DialogContent className="bottom-0 top-auto max-w-md translate-y-0 rounded-b-none rounded-t-xl">
          <DialogHeader>
            <DialogTitle className="text-title">
              {stage === 'review' || stage === 'saving' ? 'Log this meal?' : 'Add a meal photo'}
            </DialogTitle>
            <DialogDescription>
              {stage === 'analysing'
                ? 'Reading the photo…'
                : stage === 'review' || stage === 'saving'
                  ? 'Check the estimate, then save it.'
                  : stage === 'error'
                    ? 'That did not work.'
                    : 'Take a photo or choose one from your library.'}
            </DialogDescription>
          </DialogHeader>

          {preview.current && (
            <img
              src={preview.current}
              alt=""
              className="max-h-56 w-full rounded-md border border-border object-cover"
            />
          )}

          {stage === 'analysing' && (
            <div className="text-muted-foreground flex items-center gap-2 text-caption">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Analysing…
            </div>
          )}

          {draft && (stage === 'review' || stage === 'saving' || stage === 'error') && (
            <div className="rounded-md border border-border bg-background p-3">
              <p className="font-display text-display tabular leading-none">
                {Math.round(draft.total.energyKcal)}
                <span className="text-muted-foreground ml-1 text-caption">kcal</span>
              </p>
              <p className="text-muted-foreground mt-2 text-caption">
                {draft.foods.map((item) => item.food.name).join(' · ') || 'Meal'}
              </p>
              <dl className="text-caption mt-3 grid grid-cols-3 gap-2">
                {[
                  ['Protein', draft.total.proteinG],
                  ['Carbs', draft.total.carbsG],
                  ['Fat', draft.total.fatG],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular font-medium">{Math.round(Number(value))} g</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {error && (
            <p className="text-caption" role="alert" style={{ color: 'var(--destructive)' }}>
              {error}
            </p>
          )}

          <div className={cn('flex flex-col gap-2', stage === 'review' && 'mt-1')}>
            {(stage === 'review' || stage === 'saving') && (
              <Button onClick={() => void save()} disabled={busy}>
                {stage === 'saving' ? 'Saving…' : 'Save meal'}
              </Button>
            )}

            {stage === 'error' && draft && (
              <Button onClick={() => void save()} disabled={busy}>
                Try saving again
              </Button>
            )}

            {stage === 'error' && !draft && (
              <Button onClick={() => libraryInput.current?.click()} disabled={busy}>
                Choose another photo
              </Button>
            )}

            {(stage === 'review' || stage === 'error') && (
              <Button
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Discard
              </Button>
            )}

            {stage === 'idle' && (
              <>
                <Button onClick={() => cameraInput.current?.click()}>
                  <Camera className="size-4" aria-hidden /> Take a photo
                </Button>
                <Button variant="outline" onClick={() => libraryInput.current?.click()}>
                  <ImageIcon className="size-4" aria-hidden /> Choose from library
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
