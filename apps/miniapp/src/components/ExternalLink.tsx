import type { ReactNode } from 'react';
import { openExternal } from '../lib/externalLink.js';

/**
 * An anchor that always leaves the app.
 *
 * `href` is kept so the link is real (long-press to copy, right-click, a11y),
 * but the click is intercepted and routed through `openExternal` so Telegram
 * hands off to the system browser instead of rendering the page itself.
 */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
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
