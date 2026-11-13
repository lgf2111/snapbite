import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { copyText } from '@/lib/clipboard';
import {
  canShareAnything,
  canShareFile,
  downloadJson,
  exportFileName,
  shareExport,
} from '@/lib/exportFile';
import { downloadViaTelegram, getRawInitData } from '@/lib/telegram';
import { Check, Copy, Loader2, Share2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

/** What to tell someone whose export failed, from what the server said. */
export function exportErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in again, then try the export once more.';
    // The status goes to the console, never on screen.
    return err.message || 'The export failed. Try again in a moment.';
  }
  return err instanceof Error ? err.message : 'Could not export your data.';
}

/**
 * "Export my data".
 *
 * Inside Telegram the platform downloads a URL natively (blob downloads do not
 * work in its webview). Everywhere else, including the installed iOS app, the
 * export is fetched here with the session cookie and saved from a Blob. Nothing
 * is ever opened in a new tab or in-app browser: from there the only way back is
 * the X. If the file cannot be saved, a sheet shows the JSON with Copy and Share.
 */
export function ExportData({ backend }: { backend: Backend }) {
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ text: string; fileName: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  async function run() {
    const fileName = exportFileName();

    // Telegram's native downloader, with its own authentication in the URL.
    const url = backend.exportUrl();
    if (url && getRawInitData() && downloadViaTelegram(url, fileName)) {
      toast.success('Downloading export…');
      return;
    }

    setBusy(true);
    try {
      const data = await backend.exportData();
      const text = JSON.stringify(data, null, 2);

      if (!downloadJson(text, fileName)) {
        setSheet({ text, fileName });
        return;
      }
      // iOS standalone: the download may land in Files, or may not appear at all;
      // the share sheet is the dependable way to get the file out.
      toast.success('Export ready', {
        ...(canShareFile(text, fileName)
          ? {
              action: {
                label: 'Share',
                onClick: () =>
                  void shareExport(text, fileName).catch(() => setSheet({ text, fileName })),
              },
            }
          : {
              action: { label: 'Show', onClick: () => setSheet({ text, fileName }) },
            }),
      });
    } catch (err) {
      toast.error(exportErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!sheet) return;
    const ok = await copyText(sheet.text, pre.current);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
    else toast.error('Could not copy. The text is selected: use Copy from the menu.');
  }

  async function share() {
    if (!sheet) return;
    try {
      await shareExport(sheet.text, sheet.fileName);
    } catch {
      toast.error('Could not open the share sheet.');
    }
  }

  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void run()}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? 'Exporting…' : 'Export my data'}
      </Button>

      <Dialog open={sheet != null} onOpenChange={(open) => !open && setSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your data</DialogTitle>
            <DialogDescription>
              This device would not save the file, so here it is. Copy it or share it; save it as{' '}
              {sheet?.fileName}.
            </DialogDescription>
          </DialogHeader>
          <pre
            ref={pre}
            data-testid="export-json"
            className="bg-background border-border max-h-64 min-w-0 overflow-auto rounded-control border p-3 font-mono text-caption whitespace-pre"
          >
            {sheet?.text}
          </pre>
          <DialogFooter>
            {canShareAnything() && (
              <Button variant="secondary" className="gap-2" onClick={() => void share()}>
                <Share2 className="size-4" />
                Share
              </Button>
            )}
            <Button className="gap-2" onClick={() => void copy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
