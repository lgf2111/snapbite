import type { MealResult } from '@snapbite/core';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Backend } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';

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
}: ReviseWithAiDialogProps) {
  const [text, setText] = useState(initialInstruction);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

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
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    try {
      const revised = await backend.reviseDraft(mealId, instruction);
      hapticNotify('success');
      onToast?.('success', 'Applied — review and save');
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update with AI</DialogTitle>
          <DialogDescription>
            Describe the change in plain words — e.g. "add a can of coke", "the rice was double",
            or "remove the fries". You'll review the result before saving.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Describe the change…"
          value={text}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {busy && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {status}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !text.trim()} onClick={() => void submit()}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Updating…
              </>
            ) : (
              'Apply'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
