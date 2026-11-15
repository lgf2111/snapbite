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
 * The share sheet, in three separated regions: the card, then the action block.
 *
 * 1. The shell is one surface: it hugs the card plus the footer, is capped at
 *    the space above the 72 px tab bar, and never scrolls. The card and the
 *    footer are siblings in a column, so nothing can interleave with the card.
 * 2. The card region owns `min-h-0 flex-1`: it takes the height the footer
 *    leaves, and the card is sized to that height, so nothing is clipped.
 * 3. The footer is a `shrink-0` sibling after the region. Share (48 px) and the
 *    text Cancel sit inside it, above the tab bar, and never over the card.
 *
 * The `sheet-safe` bottom padding is cancelled (`pb-0!`): the shell already
 * sits above the tab bar and the safe-area inset is part of its position, so
 * paying it twice would shorten the card region. With the card scaling to fit,
 * there is no scroll container at all; the footer can never scroll away.
 *
 * Card width arithmetic: the sheet's height limit is
 * `100svh - bar - inset - 1rem` minus the sheet's 2 px hairline; the footer is
 * 133 px (1 px hairline + 16 px padding + 48 px Share + 8 px gap + 44 px
 * Cancel + 16 px padding) = 8.3125rem. The card is 4:5, so width = height ×
 * 0.8. `min(100%, ...)` keeps it inside the sheet; below that, the height term
 * shrinks the whole card.
 */
export function SharePreviewDialog({ open, onOpenChange, card, sharing, onShare }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="sheet"
        hideClose
        className="top-auto bottom-[calc(var(--spacing-bar)+env(safe-area-inset-bottom)+1rem)] flex max-h-[calc(100svh-var(--spacing-bar)-env(safe-area-inset-bottom)-1rem)] w-[calc(100%-2rem)] translate-y-0 flex-col gap-0 overflow-hidden overflow-y-hidden rounded-t-surface rounded-b-none p-0 pb-0!"
      >
        <DialogTitle className="sr-only">Share this meal</DialogTitle>
        <DialogDescription className="sr-only">
          Preview your meal card, then share it.
        </DialogDescription>

        <div
          data-testid="share-card-region"
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        >
          <div className="w-[min(100%,calc((100svh_-_var(--spacing-bar)_-_env(safe-area-inset-bottom)_-_1rem_-_8.3125rem_-_2px)_*_0.8))]">
            <ShareCard {...card} />
          </div>
        </div>

        <DialogFooter
          data-testid="share-preview-footer"
          className="shrink-0 border-t border-border p-4"
        >
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
