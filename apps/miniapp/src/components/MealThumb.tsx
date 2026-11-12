import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

/** The row's photo slot: one size, whatever it ends up showing. 56 px. */
const SLOT = 'size-14 shrink-0 rounded-control';

/** How long the row waits before asking for a failed photo one more time. */
export const THUMB_RETRY_DELAY_MS = 1000;

/**
 * A retried URL must differ from the failed one, or the browser may hand back
 * the same failed result from cache. Data/blob URLs are left alone: a query
 * string would break them.
 */
function retrySrc(src: string, attempt: number): string {
  if (attempt === 0 || /^(data|blob):/i.test(src)) return src;
  const hashAt = src.indexOf('#');
  const base = hashAt >= 0 ? src.slice(0, hashAt) : src;
  const hash = hashAt >= 0 ? src.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}retry=${attempt}${hash}`;
}

/**
 * A meal's thumbnail.
 *
 * With no `src` (a meal entered by hand) it is the placeholder from the start, so
 * every row has the same 56 px slot and the list never jumps. The row's text is
 * rendered by the caller and never waits for this image.
 *
 * A photo that cannot be loaded (a Telegram-only file id with no stored copy, an
 * expired key, a 401) must not show the browser's broken-image glyph. The first
 * failure shows the placeholder and retries once after a short delay — on a slow
 * connection the browser aborts lazy images as you scroll, and that should not
 * make a meal look photo-less forever. Only a second failure latches the
 * placeholder. The placeholder keeps the exact slot, so a late thumbnail fills it
 * without a layout shift. The meal's title already names it, so both the
 * placeholder and the image are hidden from assistive tech.
 */
export function MealThumb({ src }: { src?: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  // A new url gets its own chance: a replaced photo must not inherit a failure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `src` is the signal to reset the retry state
  useEffect(() => {
    setAttempt(0);
    setRetrying(false);
    setGaveUp(false);
  }, [src]);

  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setRetrying(false);
      setAttempt(1);
    }, THUMB_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [retrying]);

  if (!src || gaveUp || retrying) {
    return (
      <div
        data-testid="meal-thumb-placeholder"
        aria-hidden
        className={cn('bg-secondary flex items-center justify-center', SLOT)}
      >
        {/* The mark, as a background: a missing file shows nothing, not a glyph. */}
        <span
          data-testid="meal-thumb-mark"
          className="size-7 rounded-control bg-contain bg-center bg-no-repeat opacity-80"
          style={{ backgroundImage: 'url(/icon-192.png)' }}
        />
      </div>
    );
  }

  return (
    <img
      // Remount on retry so the browser starts a fresh request for the new URL.
      key={`${src}:${attempt}`}
      src={retrySrc(src, attempt)}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn('object-cover', SLOT)}
      onError={() => {
        if (attempt === 0) setRetrying(true);
        else setGaveUp(true);
      }}
    />
  );
}
