import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MealShareCardInput } from '@/lib/shareCard';
import { ShareCard } from './ShareCard.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: MealShareCardInput;
  sharing: boolean;
  onShare: () => void;
}

/**
 * The share sheet: the 4:5 card, then one caption line, the 48 px primary
 * action and a text Cancel.
 *
 * The sheet is the card's surface — no second bordered card inside it — and it
 * is sized by its content: on a 430×932 screen the 4:5 card (384×480) plus the
 * 133 px action block is 613 px, ending well above the 72 px tab bar. The
 * dialog keeps its own max-height so a shorter screen scrolls instead of
 * clipping the actions.
 */
export function SharePreviewDialog({ open, onOpenChange, card, sharing, onShare }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet" hideClose className="gap-0 p-0">
        <DialogTitle className="sr-only">Share this meal</DialogTitle>
        <DialogDescription className="sr-only">
          Preview your meal card, then share it.
        </DialogDescription>

        <ShareCard {...card} />

        <DialogFooter className="border-t border-border p-4">
          <Button className="h-12 w-full" onClick={onShare} disabled={sharing}>
            {sharing ? 'Sharing…' : 'Share meal'}
          </Button>
          {/* A text action, not a second slab: 44px tall and full width. */}
          <Button
            variant="link"
            className="w-full"
            onClick={() => onOpenChange(false)}
            disabled={sharing}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
