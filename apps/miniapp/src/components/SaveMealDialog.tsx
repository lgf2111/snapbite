import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRef } from 'react';

interface Props {
  open: boolean;
  name: string;
  saving: boolean;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

/**
 * Names a meal before saving it as a reusable favourite.
 *
 * The field gets its own label, a 44 px height and a 16 px gap before the
 * actions, so the focus ring can never be painted over the Save button. The
 * input deliberately has no `name` attribute and autocomplete off: iOS read
 * this field as a person's name and offered "AutoFill Contact" for a meal.
 * The action stack is Save (48 px, primary) over Cancel (44 px, text), not two
 * equal slabs.
 */
export function SaveMealDialog({ open, name, saving, onNameChange, onOpenChange, onSave }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? null : onOpenChange(next))}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Select the suggested name so typing replaces it instead of appending.
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Save this meal</DialogTitle>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) onSave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="meal-name">Name</Label>
            <Input
              id="meal-name"
              ref={inputRef}
              value={name}
              disabled={saving}
              placeholder="e.g. Chicken rice bowl"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>

          <DialogActions>
            <Button type="submit" className="h-12 w-full" disabled={saving}>
              {saving ? 'Saving…' : 'Save meal'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              disabled={saving}
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
