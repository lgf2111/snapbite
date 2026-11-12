import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { MealShareCardInput } from '@/lib/shareCard';
import { Share2 } from 'lucide-react';
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
      <DialogContent hideClose className="gap-0 rounded-surface p-0">
        <DialogTitle className="sr-only">Share this meal</DialogTitle>
        <DialogDescription className="sr-only">
          Preview your meal card, then share it.
        </DialogDescription>

        <ShareCard {...card} />

        <div className="border-border border-t p-4">
          <Button className="h-12 w-full gap-2" onClick={onShare} disabled={sharing}>
            <Share2 className="size-4" aria-hidden />
            {sharing ? 'Sharing…' : 'Share'}
          </Button>
          {/* A text action, not a second slab: transparent at rest, 44 px tall. */}
          <Button
            variant="ghost"
            className="text-muted-foreground mt-2 h-11 w-full"
            onClick={() => onOpenChange(false)}
            disabled={sharing}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
