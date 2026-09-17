import { Sparkles } from 'lucide-react';
import { useState } from 'react';
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

interface UpdateWithAiProps {
  backend: Backend;
  mealId: string;
  /** Render style: an icon button (compact, for rows) or a full-width button. */
  variant?: 'icon' | 'button';
  onDone?: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

/**
 * "Update with AI" — the user types a plain-language change ("add a coke",
 * "double the rice") and the meal is rewritten by the AI. Opens a small dialog
 * with an input + submit; shows a spinner while the model runs.
 */
export function UpdateWithAi({
  backend,
  mealId,
  variant = 'button',
  onDone,
  onToast,
}: UpdateWithAiProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    try {
      await backend.reviseWithAi(mealId, instruction);
      hapticNotify('success');
      onToast?.('success', 'Meal updated');
      setOpen(false);
      setText('');
      onDone?.();
    } catch (e) {
      hapticNotify('error');
      onToast?.('error', e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Update with AI"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Sparkles className="text-primary size-4" />
        </Button>
      ) : (
        <Button variant="secondary" className="gap-2" onClick={() => setOpen(true)}>
          <Sparkles className="text-primary size-4" />
          Update with AI
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => (busy ? null : setOpen(o))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update with AI</DialogTitle>
            <DialogDescription>
              Describe the change in plain words — e.g. "add a can of coke", "the rice was double",
              or "remove the fries".
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
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !text.trim()} onClick={() => void submit()}>
              {busy ? 'Updating…' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
