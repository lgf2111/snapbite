import { cn } from '@/lib/utils';
import { useState } from 'react';

/** The row's photo slot: one size, whatever it ends up showing. */
const SLOT = 'size-16 shrink-0 rounded-md';

/**
 * A meal's thumbnail.
 *
 * With no `src` (a meal entered by hand) it is the placeholder from the start, so
 * every row has the same slot and the list never jumps.
 *
 * A photo that cannot be loaded (a Telegram-only file id with no stored copy, an
 * expired key, a 401) must not show the browser's broken-image glyph. The first
 * failure swaps the image for a placeholder of the same size, so the list does not
 * jump, and it never swaps back: a failing URL is not retried in a loop. The meal's
 * title already names it, so the placeholder is hidden from assistive tech.
 */
export function MealThumb({ src }: { src?: string | null }) {
  // Remembers WHICH url failed, so a new url (the meal was edited, the photo
  // replaced) gets its own chance.
  const [failed, setFailed] = useState<string | null>(null);

  // No photo to ask for (a manually entered meal), or the one we asked for failed.
  if (!src || failed === src) {
    return (
      <div
        data-testid="meal-thumb-placeholder"
        aria-hidden
        className={cn('bg-secondary flex items-center justify-center', SLOT)}
      >
        {/* The mark, as a background: a missing file shows nothing, not a glyph. */}
        <span
          data-testid="meal-thumb-mark"
          className="size-7 rounded-md bg-contain bg-center bg-no-repeat opacity-80"
          style={{ backgroundImage: 'url(/icon-192.png)' }}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn('object-cover', SLOT)}
      onError={() => setFailed(src)}
    />
  );
}
