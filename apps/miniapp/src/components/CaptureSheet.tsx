import { cn } from '@/lib/utils';
import type { MealResult } from '@snapbite/core';
import { Loader2 } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import type { Backend } from '../lib/backend.js';
import { compressPhoto } from '../lib/compress.js';
import { type CaptureAction, CaptureMenu } from './CaptureMenu.js';
import { ManualMealDialog } from './ManualMealDialog.js';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Stage = 'idle' | 'analysing' | 'review' | 'saving' | 'error';

interface Props {
  backend: Backend;
  /** The add-a-meal menu (CaptureMenu) is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The camera button the menu grows out of. */
  triggerRef: RefObject<HTMLElement | null>;
  onLogged: (result: MealResult) => void;
  /** A meal was logged through the by-hand form (no AI result to hand back). */
  onManualLogged: () => void;
  onToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}

/**
 * The add-a-meal flow: the four-card menu, the hidden file inputs it drives, and
 * the sheet that shows a photo being read and then reviewed.
 *
 * Photo capture is a state machine rather than one gesture.
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
export function CaptureSheet({
  backend,
  open,
  onOpenChange,
  triggerRef,
  onLogged,
  onManualLogged,
  onToast,
}: Props) {
  /** The by-hand dialog; it carries the saved-meals list, so both cards open it. */
  const [manualOpen, setManualOpen] = useState(false);
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
    // Picker cancelled: nothing to read.
    if (!file) return;
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

  /**
   * A card was tapped. The menu closes at once so a file picker or a dialog is
   * not competing with an overlay; the picker's `click()` stays inside this tap,
   * which iOS requires.
   */
  function pick(action: CaptureAction) {
    if (action === 'photo') cameraInput.current?.click();
    else if (action === 'upload') libraryInput.current?.click();
    else setManualOpen(true);
    onOpenChange(false);
  }

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

      <CaptureMenu
        open={open}
        onClose={() => onOpenChange(false)}
        onPick={pick}
        triggerRef={triggerRef}
      />

      <Dialog
        open={stage !== 'idle'}
        onOpenChange={(next) => {
          // Closing mid-save would hide a failure the person needs to see.
          if (!next && stage === 'saving') return;
          if (!next) reset();
        }}
      >
        <DialogContent className="sheet-safe bottom-0 top-auto max-w-md translate-y-0 rounded-b-none rounded-t-xl duration-200 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100">
          <DialogHeader>
            <DialogTitle className="text-title">
              {stage === 'review' || stage === 'saving' ? 'Log this meal?' : 'Add a meal photo'}
            </DialogTitle>
            <DialogDescription>
              {stage === 'analysing'
                ? 'Reading the photo…'
                : stage === 'review' || stage === 'saving'
                  ? 'Check the estimate, then save it.'
                  : 'That did not work.'}
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
            <p className="text-destructive text-caption" role="alert">
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
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ManualMealDialog
        backend={backend}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onLogged={onManualLogged}
        onToast={onToast}
      />
    </>
  );
}
