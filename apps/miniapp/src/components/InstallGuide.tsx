import { ChevronDown, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isIosSafari, useInstallState } from '../lib/install.js';
import { isTelegramEnv } from '../lib/telegram.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';

/** Versioned, so a redesign of the card can reset everyone's dismissal. */
const STORAGE_KEY = 'snapbite.install-guide.v1';
const HIDE_DAYS = 14;

interface Stored {
  /** Epoch ms until which the card stays hidden. */
  until?: number;
  /** Shown at least once, so later visits start collapsed. */
  seen?: boolean;
}

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

function write(next: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the card just comes back next visit.
  }
}

/**
 * A quiet "install this on your phone" card for mobile browsers.
 *
 * Shown only on iOS/Android, never when already running installed, and never
 * inside Telegram. The first time it shows expanded; after that it is a single
 * compact row so it does not push the rings down. Dismissing hides it for 14
 * days. iOS cannot be installed from a button (no API), so it only gets
 * instructions; Android gets a real button when Chrome offered a prompt.
 */
export function InstallGuide() {
  const { platform, standalone, canPrompt, promptInstall } = useInstallState();
  const [stored, setStored] = useState<Stored>(read);
  const [expanded, setExpanded] = useState(() => !read().seen);

  // Remember that it has been shown, so the next visit starts collapsed.
  useEffect(() => {
    if (!stored.seen) write({ ...read(), seen: true });
  }, [stored.seen]);

  if (platform === 'other' || standalone || isTelegramEnv()) return null;
  if (stored.until && Date.now() < stored.until) return null;

  function dismiss() {
    const next = { until: Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000, seen: false };
    write(next);
    setStored(next);
  }

  const ios = platform === 'ios';

  return (
    <Card data-testid="install-guide" className="gap-0 p-0">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="install-guide-body"
          onClick={() => setExpanded((v) => !v)}
          className="text-caption flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-4 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Smartphone className="text-primary-text size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 font-medium">Install SnapBite on your phone</span>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss install tip" onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {expanded && (
        <div id="install-guide-body" className="text-caption flex flex-col gap-3 px-4 pt-1 pb-4">
          <p className="text-muted-foreground">
            Installed, the camera opens straight from the icon and SnapBite uses the full screen,
            including under the notch.
          </p>

          {ios ? (
            <>
              {!isIosSafari() && <p>These steps are for Safari. Open this page in Safari first.</p>}
              <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                <li>
                  Tap the Share button at the bottom of Safari — the square with an arrow pointing
                  up.
                </li>
                <li>Scroll down and tap Add to Home Screen, then Add.</li>
              </ol>
            </>
          ) : (
            <>
              {canPrompt && (
                <Button size="sm" className="self-start" onClick={() => void promptInstall()}>
                  Install app
                </Button>
              )}
              <p>
                {canPrompt ? 'Or open' : 'Open'} the ⋮ menu in the top-right of Chrome, then tap
                Install app (some phones say Add to Home screen).
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
