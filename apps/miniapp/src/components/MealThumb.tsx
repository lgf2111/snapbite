import { cn } from '@/lib/utils';
import { Utensils } from 'lucide-react';
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

interface ThumbState {
  /** The `src` this state belongs to. A different string starts a new cycle. */
  src: string | null;
  /** 0 for the first request, 1 for the one retry. */
  attempt: number;
  /** The first request failed; the retry is waiting. */
  retrying: boolean;
  /** The retry failed too: stay on the placeholder. */
  gaveUp: boolean;
  /** The src whose bytes are (or were last) on screen. */
  loadedSrc: string | null;
}

function initialState(src: string | null): ThumbState {
  return { src, attempt: 0, retrying: false, gaveUp: false, loadedSrc: null };
}

/**
 * A meal's thumbnail.
 *
 * With no `src` (a meal entered by hand) it is the placeholder from the start, so
 * every row has the same 56 px slot and the list never jumps. The row's text is
 * rendered by the caller and never waits for this image.
 *
 * The placeholder is a layer *behind* the image, not an alternative to it. A
 * new `src` therefore never blanks the slot: the browser keeps the previous
 * frame (or paints a cache hit at once) over the placeholder, and `onLoad`
 * removes the placeholder. Only a failure shows the placeholder on its own.
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
  const current = src || null;
  const [state, setState] = useState<ThumbState>(() => initialState(current));

  // A different URL starts its own retry cycle; the same URL keeps the cycle it
  // already has. This comparison is what stops a parent re-render from looking
  // like a reload: the <img> is never remounted and `attempt` is never reset.
  if (state.src !== current) setState(initialState(current));

  useEffect(() => {
    if (!state.retrying) return;
    const timer = setTimeout(() => {
      setState((s) => (s.src === current ? { ...s, retrying: false, attempt: 1 } : s));
    }, THUMB_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.retrying, current]);

  const { attempt, retrying, gaveUp, loadedSrc } = state;
  const showImage = Boolean(current) && !retrying && !gaveUp;
  const showPlaceholder = !current || retrying || gaveUp || loadedSrc !== current;

  return (
    <div data-testid="meal-thumb" className={cn('relative overflow-hidden', SLOT)}>
      {showPlaceholder && (
        <div
          data-testid="meal-thumb-placeholder"
          aria-hidden
          className="bg-secondary absolute inset-0 flex items-center justify-center"
        >
          {/* A meal with no photo reads as "no photo", not as an empty grey box. */}
          <Utensils
            data-testid="meal-thumb-icon"
            className="text-muted-foreground size-4"
            aria-hidden
          />
        </div>
      )}
      {showImage && current && (
        <img
          src={retrySrc(current, attempt)}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="absolute inset-0 size-full object-cover"
          onLoad={() =>
            setState((s) =>
              s.src === current && s.loadedSrc !== current ? { ...s, loadedSrc: current } : s,
            )
          }
          onError={() =>
            setState((s) => {
              if (s.src !== current) return s;
              return s.attempt === 0 ? { ...s, retrying: true } : { ...s, gaveUp: true };
            })
          }
        />
      )}
    </div>
  );
}
