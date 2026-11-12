import { Check, ChevronDown, Copy, KeyRound } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CreatedDeviceToken, DeviceTokenInfo } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';
import { installPlatform, isStandalone } from '../lib/install.js';
import { navigateTo } from '../lib/navigate.js';
import {
  SHORTCUT_FILE_PATH,
  SHORTCUT_FILE_URL,
  SHORTCUT_ICLOUD_URL,
  SHORTCUT_LOG_URL,
  SHORTCUT_TOKEN_FIELD,
  SHORTCUT_TOKEN_PLACEHOLDER,
} from '../lib/shortcut.js';
import { Button } from './ui/button.js';
import { Card, CardContent } from './ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';

type Confirm = { kind: 'one'; token: DeviceTokenInfo } | { kind: 'all' } | null;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

type Panel = 'easy' | 'hand';

/**
 * One row of the two-row accordion: the help panel's pattern (a native
 * `<button aria-expanded>`, a chevron that turns, content that stays mounted but
 * hidden). Which row is open is the card's call, so only one can be.
 */
function AccordionRow({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** A short qualifier beside the title, e.g. "iOS only". */
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="rounded-surface border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left font-medium transition-[background-color,transform] duration-[120ms] active:scale-[0.99] active:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">{title}</span>
          {badge && (
            <span
              aria-label={badge}
              className="bg-secondary text-muted-foreground text-caption shrink-0 rounded-control px-2 py-0.5 font-normal whitespace-nowrap"
            >
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out-quint)] motion-reduce:transition-none"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      <div id={id} hidden={!open} className="flex min-w-0 flex-col gap-3 px-3 pb-3">
        {children}
      </div>
    </div>
  );
}

/** `iPhone Shortcut · a3f9`: the device, and a short suffix to tell two tokens apart. */
export function newTokenLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone|iPod/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : 'Browser';
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `${device} Shortcut · ${suffix}`;
}

/**
 * What to call a token on screen. New ones carry their own suffix; older ones were all
 * just "iOS Shortcut", so the start of the id stands in and two of them can be told apart.
 */
export function tokenName(t: DeviceTokenInfo): string {
  const label = t.label ?? 'Token';
  return / · [0-9a-f]{4}$/.test(label) ? label : `${label} · ${t.id.slice(0, 4)}`;
}

/**
 * Copies `text` and reports it for two seconds. When the Clipboard API is
 * missing or refuses (some installed-PWA contexts), the visible text is
 * selected instead so a long-press offers Copy.
 */
function CopyButton({
  text,
  target,
  label,
}: {
  text: string;
  target: React.RefObject<HTMLElement | null>;
  label: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let next: 'copied' | 'manual' = 'copied';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'manual';
      const el = target.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        onClick={() => void copy()}
      >
        {state === 'copied' ? (
          <Check className="text-primary-text size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {state === 'manual' && (
        <output className="text-muted-foreground text-caption">Press and hold to copy.</output>
      )}
    </span>
  );
}

/**
 * One-tap logging: create, show-once, and revoke the device token the iOS
 * Shortcut authenticates with. The raw token lives only in component state and
 * is dropped on "Done" or when it is revoked; the server keeps only a hash.
 */
export function ShortcutCard({ backend }: { backend: Backend }) {
  const [tokens, setTokens] = useState<DeviceTokenInfo[] | null>(null);
  const [fresh, setFresh] = useState<CreatedDeviceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const tokenRef = useRef<HTMLElement | null>(null);
  const urlRef = useRef<HTMLElement | null>(null);
  // Both closed, except that the easy path opens itself on a phone that reports iOS.
  const [panel, setPanel] = useState<Panel | null>(() =>
    installPlatform() === 'ios' ? 'easy' : null,
  );
  const fileRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const preflightCancelRef = useRef<HTMLButtonElement | null>(null);
  const [preflight, setPreflight] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens(await backend.listDeviceTokens());
    } catch (e) {
      setTokens((prev) => prev ?? []);
      setError(e instanceof Error ? e.message : 'Could not load tokens');
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setFresh(await backend.createDeviceToken(newTokenLabel()));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a token');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      if (confirm.kind === 'all') {
        await backend.revokeAllDeviceTokens();
        setFresh(null);
      } else {
        await backend.revokeDeviceToken(confirm.token.id);
        if (fresh?.id === confirm.token.id) setFresh(null);
      }
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const standalone = useState(isStandalone)[0];
  // Apple's iCloud link opens a real import screen, so it leads when we have one; until
  // then the plain https file is the way in.
  const icloud = SHORTCUT_ICLOUD_URL;
  const addHref = icloud || SHORTCUT_FILE_URL;
  const hasToken = tokens != null && tokens.length > 0;
  // A returning user has been through this: a token that has actually been used.
  const hasUsedToken = tokens?.some((t) => t.lastUsedAt != null) ?? false;
  // Where Continue goes: Apple's import page when we have one, else the file itself.
  const target = icloud || SHORTCUT_FILE_PATH;
  const Add = (
    <Button asChild>
      {/* A plain https link: no fetch, no blob, no download attribute, and not the
          shortcuts:// scheme, which iOS 26 rejects for a file URL. Until a token has been
          used it first explains the hand-off (the page it lands on looks like nothing);
          after that the link just works. */}
      <a
        href={addHref}
        onClick={(e) => {
          if (hasUsedToken) return;
          e.preventDefault();
          setPreflight(true);
        }}
      >
        Add the Shortcut
      </a>
    </Button>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="text-primary-text size-5" aria-hidden />
          <span className="font-medium">One-tap photo logging</span>
        </div>
        <p className="text-muted-foreground text-caption">
          Log a meal from the Action Button or Lock Screen — no app to open.
        </p>

        {installPlatform() === 'android' && (
          <p className="text-caption">
            On Android there is no Action Button. Long-press the SnapBite icon and pick Take a
            photo, or share a photo to SnapBite from your gallery.
          </p>
        )}

        {!standalone && (
          <p className="text-muted-foreground text-caption">
            Add SnapBite to your Home Screen first — the shortcut works without it, but the
            notification is easier to reach.
          </p>
        )}

        {/* The token comes first: both ways below end by pasting it. */}
        {fresh ? (
          <div className="flex flex-col gap-2 rounded-control border border-border p-3">
            <code
              ref={tokenRef}
              className="tabular text-caption font-mono select-all break-words [overflow-wrap:anywhere]"
              data-testid="new-token"
            >
              {fresh.token}
            </code>
            <div className="flex items-center justify-between gap-2">
              <CopyButton text={fresh.token} target={tokenRef} label="Copy token" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
            <p className="text-destructive text-caption" role="alert">
              Copy it now — it will not be shown again.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant={hasToken ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => void create()}
          >
            Create Shortcut token
          </Button>
        )}

        <AccordionRow
          title="Set up with Shortcut app"
          badge="iOS only"
          open={panel === 'easy'}
          onToggle={() => setPanel(panel === 'easy' ? null : 'easy')}
        >
          <p className="text-caption">
            SnapBite gives you a ready-made shortcut. You only add your token.
          </p>
          {Add}
          <div className="flex flex-col gap-1">
            <code
              ref={fileRef}
              data-testid="shortcut-file-url"
              className="text-caption font-mono select-all break-words [overflow-wrap:anywhere]"
            >
              {addHref}
            </code>
            {/* For anyone whose preview gets stuck: paste it into Safari by hand. */}
            <CopyButton text={addHref} target={fileRef} label="Copy link" />
            {icloud && (
              <a
                href={SHORTCUT_FILE_URL}
                className="text-primary-text text-caption underline-offset-4 hover:underline"
              >
                Use the file link instead
              </a>
            )}
          </div>
          <ol className="text-caption flex list-decimal flex-col gap-1.5 pl-5">
            <li>Add the Shortcut.</li>
            <li>
              {icloud
                ? 'Tap Get Shortcut, then Add Shortcut.'
                : 'Tap Open in Shortcuts, then Add Shortcut.'}
            </li>
            <li>
              Open the shortcut, tap {SHORTCUT_TOKEN_FIELD}, replace{' '}
              <code className="font-mono">{SHORTCUT_TOKEN_PLACEHOLDER}</code> with your token from
              above, keeping the word Bearer and one space.
            </li>
            <li>Settings → Action Button → Shortcut → SnapBite Log Meal.</li>
          </ol>
          <p className="text-muted-foreground text-caption">
            Hold the Action Button, take a photo, the notification tells you what was logged.
          </p>
        </AccordionRow>

        <AccordionRow
          title="Set up manually"
          open={panel === 'hand'}
          onToggle={() => setPanel(panel === 'hand' ? null : 'hand')}
        >
          <ol className="text-caption flex list-decimal flex-col gap-2 pl-5">
            <li>Take Photo — turn on Show Camera Preview.</li>
            <li>Convert Image → JPEG, quality 0.6.</li>
            <li>
              Get Contents of URL:
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                <li className="break-words [overflow-wrap:anywhere]">
                  URL{' '}
                  <code ref={urlRef} className="font-mono">
                    {SHORTCUT_LOG_URL}
                  </code>
                </li>
                <li>Method POST, Request Body Form.</li>
                <li>
                  New field <code className="font-mono">photo</code>, type File, value Converted
                  Image.
                </li>
                <li>
                  Header <code className="font-mono">{SHORTCUT_TOKEN_FIELD}</code> = Bearer, a
                  space, then your token.
                </li>
              </ul>
              <CopyButton text={SHORTCUT_LOG_URL} target={urlRef} label="Copy URL" />
            </li>
            <li>
              Show Notification → Title Meal logged, Body Contents of URL, Attachment Converted
              Image.
            </li>
          </ol>
          <p className="text-muted-foreground text-caption">
            Convert Image is not optional: iPhones shoot HEIC and the server only accepts JPEG.
          </p>
        </AccordionRow>

        {error && (
          <p className="text-destructive text-caption" role="alert">
            {error}
          </p>
        )}

        {tokens && tokens.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <ul className="flex flex-col gap-2">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-caption min-w-0">
                    {tokenName(t)} · {fmtDate(t.createdAt)} ·{' '}
                    {t.lastUsedAt ? `used ${fmtDate(t.lastUsedAt)}` : 'never used'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Revoke ${tokenName(t)} from ${fmtDate(t.createdAt)}`}
                    onClick={() => setConfirm({ kind: 'one', token: t })}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive self-start"
              onClick={() => setConfirm({ kind: 'all' })}
            >
              Revoke all
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={preflight} onOpenChange={setPreflight}>
        <DialogContent
          className="p-6"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            preflightCancelRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Before you add the shortcut</DialogTitle>
          <DialogDescription asChild>
            <div className="text-foreground flex flex-col gap-3 text-body">
              <p>You will leave SnapBite for a moment.</p>
              <p>
                {icloud
                  ? 'Tap Get Shortcut, then Add Shortcut.'
                  : 'Tap Open in Shortcuts, then Add Shortcut.'}
              </p>
              <p>Come back here and paste your token into the {SHORTCUT_TOKEN_FIELD} field.</p>
            </div>
          </DialogDescription>
          {/* Cancel first in the DOM; Continue below it, the primary action. */}
          <DialogFooter className="-mx-6 -mb-6 flex-col px-6 pb-6">
            <Button
              ref={preflightCancelRef}
              variant="secondary"
              className="w-full"
              onClick={() => setPreflight(false)}
            >
              Cancel
            </Button>
            <Button
              className="w-full"
              onClick={() => {
                // Inside the tap, so it is a navigation and not a blocked popup.
                navigateTo(target);
                setPreflight(false);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent
          // 24px of padding; the footer's negative margins follow it so its pinned
          // background still reaches the panel's edges.
          className="p-6"
          onOpenAutoFocus={(e) => {
            // The safe choice is the one that has focus.
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'all' ? 'Revoke all tokens?' : 'Revoke this token?'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'all'
                ? 'Every Shortcut using a token stops working until you make a new one.'
                : 'Any Shortcut using it stops working until you make a new one.'}
            </DialogDescription>
          </DialogHeader>
          {confirm?.kind === 'one' && (
            <p
              data-testid="revoke-target"
              className="bg-secondary text-secondary-foreground text-caption min-w-0 rounded-control px-3 py-2 font-medium break-words [overflow-wrap:anywhere]"
            >
              {tokenName(confirm.token)} · {fmtDate(confirm.token.createdAt)}
            </p>
          )}
          {/* Cancel first in the DOM (and so in the tab order and to a screen reader),
              and above the destructive action on screen: the iOS order. */}
          <DialogFooter className="-mx-6 -mb-6 flex-col px-6 pb-6">
            <Button
              ref={cancelRef}
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              disabled={busy}
              onClick={() => void runConfirmed()}
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
