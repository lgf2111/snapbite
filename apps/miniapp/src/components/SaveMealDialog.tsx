import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const valid = name.trim().length > 0;

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
          <DialogDescription>Name it so you can find and log it again later.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !saving) onSave();
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
              className="h-11"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Button type="submit" className="h-12 w-full" disabled={saving || !valid}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground h-11 w-full"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
