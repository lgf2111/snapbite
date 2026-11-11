import { type ReactNode, useId, useState } from 'react';

interface HelpItem {
  /** Short label in the collapsed row. */
  title: string;
  /** One line shown under the label while collapsed. */
  summary?: string;
  children: ReactNode;
}

/**
 * "Need help?" accordion.
 *
 * Native `<button aria-expanded>` + a plain div rather than <details>, so the
 * open/close animation and styling behave the same in Safari's in-app webview,
 * Chrome, and the Telegram client.
 */
export function HelpAccordion({
  items,
  label = 'Need help?',
}: { items: HelpItem[]; label?: string }) {
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-border/60">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span aria-hidden className="text-sm">
          💡
        </span>
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
      </div>

      <ul className="divide-y divide-border/50">
        {items.map((item, i) => {
          const id = `${baseId}-${i}`;
          const isOpen = open === i;
          return (
            <li key={item.title}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-[background-color,transform] duration-[120ms] active:scale-[0.99] active:bg-accent/60 motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.summary && !isOpen && (
                    <span className="text-muted-foreground mt-0.5 text-xs">{item.summary}</span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="text-muted-foreground shrink-0 text-xs transition-transform duration-200 ease-[var(--ease-out-quint)] motion-reduce:transition-none"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                >
                  ▾
                </span>
              </button>
              <div id={id} hidden={!isOpen} className="px-4 pb-4">
                {item.children}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One numbered step: badge, instruction, optional illustration. */
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="bg-primary/15 text-primary-text mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * A figure with a real screenshot when one has been added, and a labelled
 * diagram when it has not. Drop `ai-studio-1.png` … into `public/help/` to
 * replace the drawings with captures — no code change needed.
 */
export function HelpFigure({
  src,
  alt,
  caption,
  fallback,
}: {
  src: string;
  alt: string;
  caption: string;
  fallback: ReactNode;
}) {
  const [missing, setMissing] = useState(false);

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="overflow-hidden rounded-lg border border-border/60 bg-black/20">
        {missing ? (
          fallback
        ) : (
          <img
            src={src}
            alt={alt}
            // Not lazy: `loading="lazy"` inside a collapsed panel never fires,
            // so a missing screenshot would show nothing instead of the diagram.
            decoding="async"
            className="block h-auto w-full"
            onError={() => setMissing(true)}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth === 0) setMissing(true);
            }}
          />
        )}
      </div>
      <figcaption className="text-muted-foreground text-[11px]">{caption}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Diagrams — used when no screenshot is present. Drawn, not captured, */
/* so they never contain anyone else's data.                          */
/* ------------------------------------------------------------------ */

const FRAME = 'w-full';
const MUTED = '#8b97a6';
const TEXT = '#e7edf5';
const ACCENT = '#3aa0ff';
const SURFACE = '#111a23';

/** Browser chrome with an address bar. */
export function MockBrowser({ url, children }: { url: string; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 360 200" className={FRAME} role="img" aria-label={`Browser showing ${url}`}>
      <rect width="360" height="200" fill="#0b1219" />
      <rect x="0" y="0" width="360" height="26" fill="#1a242f" />
      <circle cx="12" cy="13" r="3.5" fill="#41505f" />
      <circle cx="24" cy="13" r="3.5" fill="#41505f" />
      <circle cx="36" cy="13" r="3.5" fill="#41505f" />
      <rect x="52" y="7" width="220" height="12" rx="6" fill="#0b1219" stroke="#2b3947" />
      <text x="60" y="16" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        {url}
      </text>
      {children}
    </svg>
  );
}

export { ACCENT, MUTED, TEXT, SURFACE };
