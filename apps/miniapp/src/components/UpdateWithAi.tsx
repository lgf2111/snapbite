import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Backend } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import type { MealResult } from '@snapbite/core';
import { useEffect, useRef, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ReviseWithAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backend: Backend;
  mealId: string;
  /** Pre-fill the instruction (e.g. when opened from a Home row). */
  initialInstruction?: string;
  /**
   * Called with the AI's revised meal (a DRAFT). The parent applies it to the
   * editable meal for review; nothing is saved until the user hits Save.
   */
  onDraft: (revised: MealResult) => void;
  onToast?: (kind: ToastKind, message: string) => void;
  /** One-line credit trace when a BYOK call overflowed onto our key. */
  onCreditNotice?: (notice: string) => void;
}

/**
 * "Update with AI" dialog. The user types a plain-language change ("add a
 * coke", "double the rice"); the meal is revised by the AI and returned as a
 * draft for review. The parent screen applies the draft and the user saves.
 */
export function ReviseWithAiDialog({
  open,
  onOpenChange,
  backend,
  mealId,
  initialInstruction = '',
  onDraft,
  onToast,
  onCreditNotice,
}: ReviseWithAiDialogProps) {
  const [text, setText] = useState(initialInstruction);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const instruction = text.trim();
  /** A one-word instruction is not enough to revise a meal. */
  const valid = instruction.length >= 3;

  // Reset the input to the initial instruction whenever the dialog opens.
  useEffect(() => {
    if (open) setText(initialInstruction);
  }, [open, initialInstruction]);

  // Cycle a status message while the model runs so it visibly progresses.
  useEffect(() => {
    if (!busy) {
      setStatus('');
      return;
    }
    const steps = [
      'Reading your meal…',
      'Asking the AI…',
      'Recalculating nutrition…',
      'Almost there…',
    ];
    let i = 0;
    setStatus(steps[0] ?? '');
    const id = setInterval(() => {
      i = (i + 1) % steps.length;
      setStatus(steps[i] ?? '');
    }, 2500);
    return () => clearInterval(id);
  }, [busy]);

  async function submit() {
    if (busy) return;
    if (!valid) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const { notice, ...revised } = await backend.reviseDraft(mealId, instruction);
      if (notice) onCreditNotice?.(notice);
      hapticNotify('success');
      onToast?.('success', 'Applied. Review, then save.');
      onDraft(revised);
      onOpenChange(false);
      setText('');
    } catch (e) {
      hapticNotify('error');
      onToast?.('error', e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : onOpenChange(o))}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Update with AI</DialogTitle>
          <DialogDescription>
            Describe the change in plain words, for example "add a can of coke", "the rice was
            double", or "remove the fries". Review the result before saving.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-change">Change</Label>
            <Textarea
              id="ai-change"
              ref={inputRef}
              placeholder="Describe the change…"
              value={text}
              maxLength={500}
              disabled={busy}
              className="min-h-24"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {busy && (
            <p className="text-muted-foreground text-caption" aria-live="polite">
              {status}
            </p>
          )}
          <DialogActions>
            <Button type="submit" className="h-12 w-full" disabled={busy}>
              {busy ? 'Updating…' : 'Update meal'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
