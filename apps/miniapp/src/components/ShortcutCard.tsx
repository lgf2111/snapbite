import { Check, Copy, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatedDeviceToken, DeviceTokenInfo } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';
import { readConfig } from '../lib/config.js';
import { isStandalone } from '../lib/install.js';
import {
  SHORTCUT_FILE_URL,
  SHORTCUT_ICLOUD_URL,
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

/** The by-hand route, for a phone where adding the file does not work. */
const HAND_STEPS = [
  'Shortcuts → new shortcut → Take Photo → Convert Image (JPEG).',
  'Add Get Contents of URL: Method POST, Request Body Form.',
  'Add field photo, type File, value Converted Image.',
  'Add header Authorization = Bearer, a space, then the token above.',
  'Add Show Notification: Title Meal logged, Body Contents of URL, Attachment Photo.',
];

type Confirm = { kind: 'one'; token: DeviceTokenInfo } | { kind: 'all' } | null;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

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
  // Same origin as the app: the Shortcut posts through the same proxy.
  const endpoint = `${readConfig().apiBase || window.location.origin}/api/shortcut/log`;
  const [tokens, setTokens] = useState<DeviceTokenInfo[] | null>(null);
  const [fresh, setFresh] = useState<CreatedDeviceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const tokenRef = useRef<HTMLElement | null>(null);
  const urlRef = useRef<HTMLElement | null>(null);
  const fileRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

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
  // Three steps, visible. Once there is a token the person has been through them, so
  // they fold into one line (and only then).
  const collapse = hasToken && !fresh;

  const steps = (
    <ol className="flex flex-col gap-4">
      <li className="flex flex-col gap-1.5">
        <p className="font-medium">1. Get the shortcut</p>
        <Button asChild>
          {/* A plain https link: no fetch, no blob, no download attribute, and not the
              shortcuts:// scheme, which iOS 26 rejects for a file URL. */}
          <a href={addHref}>Add the Shortcut</a>
        </Button>
        <p className="text-muted-foreground text-caption">
          {icloud
            ? 'It opens the Shortcuts import screen — tap Get Shortcut, then Add Shortcut.'
            : 'It opens a file preview — tap Open in Shortcuts, then Add Shortcut.'}
        </p>
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
      </li>

      <li className="flex flex-col gap-1.5">
        <p className="font-medium">2. Put your token in it</p>
        <p className="text-muted-foreground text-caption">
          You do this after the shortcut is added, inside the Shortcuts app — not in SnapBite.
        </p>
        <p className="text-caption">
          Open the shortcut → tap the {SHORTCUT_TOKEN_FIELD} field → replace{' '}
          <code className="font-mono">{SHORTCUT_TOKEN_PLACEHOLDER}</code> with your token (keep the
          word Bearer and the space after it) → tap Done.
        </p>
        <p className="text-muted-foreground text-caption">
          Your token is the text that starts with <code className="font-mono">sb_</code>. It is
          shown only once, so copy it first.
        </p>
        <p className="text-caption">
          Then tap Show Notification: set Title to <strong>Meal logged</strong>, Body to Contents of
          URL, and Attachment to Photo. That is what makes it look like the card in the app.
        </p>

        {fresh ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
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
      </li>

      <li className="flex flex-col gap-1.5">
        <p className="font-medium">3. Point the Action Button at it</p>
        <p className="text-caption">
          Open Settings → Action Button → Shortcut → SnapBite Log Meal.
        </p>
      </li>
    </ol>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="text-primary-text size-5" aria-hidden />
          <span className="font-medium">One-tap photo logging</span>
        </div>
        <p className="text-muted-foreground text-caption">
          Hold the Action Button, take a photo, and the notification says what was logged.
        </p>

        {!standalone && (
          <p className="text-muted-foreground text-caption">
            Add SnapBite to your Home Screen first — the shortcut works without it, but the
            notification is easier to reach.
          </p>
        )}

        {collapse ? (
          <details className="group rounded-md border border-border p-3">
            <summary className="cursor-pointer text-caption font-medium">How it works</summary>
            <div className="pt-3">{steps}</div>
          </details>
        ) : (
          steps
        )}

        <details className="text-caption">
          <summary className="text-muted-foreground cursor-pointer">
            Can't add it? Set it up by hand
          </summary>
          <div className="flex flex-col gap-2 pt-2">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {HAND_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <code
              ref={urlRef}
              className="font-mono select-all break-words [overflow-wrap:anywhere]"
            >
              {endpoint}
            </code>
            <CopyButton text={endpoint} target={urlRef} label="Copy URL" />
          </div>
        </details>

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
              className="bg-secondary text-secondary-foreground text-caption min-w-0 rounded-md px-3 py-2 font-medium break-words [overflow-wrap:anywhere]"
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
