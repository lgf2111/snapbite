import { Loader2, Sparkles } from 'lucide-react';
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
  const [status, setStatus] = useState('');

  // While the AI runs, cycle a status message so it visibly progresses instead
  // of looking hung on a static "Updating…".
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
          {busy && (
            <p
              className="text-muted-foreground flex items-center gap-2 text-sm"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin" />
              {status}
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !text.trim()} onClick={() => void submit()}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating…
                </>
              ) : (
                'Update'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
