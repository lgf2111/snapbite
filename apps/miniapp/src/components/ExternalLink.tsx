import { Copy } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import { openExternal } from '../lib/externalLink.js';
import { isStandalone } from '../lib/install.js';
import { isTelegramEnv } from '../lib/telegram.js';
import { cn } from '../lib/utils.js';

interface Props {
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * A link that leaves the app.
 *
 * In a browser tab it is an anchor that opens a new tab. Installed to the iOS
 * Home Screen it cannot be: a standalone web app cannot hand off to Safari, and
 * `target="_blank"` lands in an in-app view that renders some sites (Google AI
 * Studio) blank, with its only exit, a small compass icon, easy to miss. There it
 * becomes a copy control with the address printed beneath it, so the way
 * through is "copy, paste into Safari". Inside Telegram `openLink` does hand
 * off properly, so that path is unchanged.
 */
export function ExternalLink({ href, children, className }: Props) {
  if (isStandalone() && !isTelegramEnv()) {
    return (
      <CopyLink href={href} className={className}>
        {children}
      </CopyLink>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        // Let modifier-clicks behave like normal links (desktop power users).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

/**
 * Inline, never a modal: the button copies, the address stays visible and
 * selectable (so a refused clipboard still leaves a way through), and the two
 * instruction lines appear below and go away on any tap outside.
 */
function CopyLink({ href, children, className }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const root = useRef<HTMLSpanElement>(null);
  const url = useRef<HTMLElement>(null);

  useEffect(() => {
    if (state === 'idle') return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setState('idle');
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [state]);

  async function copy() {
    setState((await copyText(href, url.current)) ? 'copied' : 'manual');
  }

  return (
    <span ref={root}>
      {/* The hit area grows with padding and an equal negative margin, so a link inside a
          sentence does not push its lines apart. */}
      <button
        type="button"
        aria-label={`Copy link to ${hostOf(href)}`}
        onClick={() => void copy()}
        className={cn(
          '-my-2 inline-flex items-center gap-1 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
      >
        {children}
        <Copy className="size-3.5 shrink-0" aria-hidden />
      </button>
      <code
        ref={url}
        className="text-foreground text-caption mt-1 block font-mono select-all [overflow-wrap:anywhere]"
      >
        {href}
      </code>
      {state !== 'idle' && (
        <output className="text-foreground text-caption mt-1 block">
          <span className="block font-medium">
            {state === 'copied'
              ? 'Copied. Paste it into Safari.'
              : 'Couldn’t copy. Press and hold the address above to copy it, then paste it into Safari.'}
          </span>
          <span className="text-muted-foreground block">
            Or{' '}
            <button
              type="button"
              className="text-primary-text underline"
              onClick={() => openExternal(href)}
            >
              open it here
            </button>{' '}
            and tap the compass icon at the bottom-right to open Safari.
          </span>
        </output>
      )}
    </span>
  );
}

function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}
