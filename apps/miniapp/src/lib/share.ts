/**
 * Sharing/saving an in-memory image blob.
 *
 * Telegram's native `downloadFile` only accepts public HTTPS URLs, not the
 * `blob:` URL of a canvas-generated image, so we rely on standard web APIs:
 *  - Web Share API with a File (`navigator.share`) opens the OS share sheet
 *    (Instagram, Save Image, etc.). This works on mobile, including inside the
 *    Telegram webview on modern iOS/Android.
 *  - Where file sharing isn't supported (desktop browsers), we fall back to a
 *    normal download of the blob.
 */

/** Whether the browser can share files via the Web Share API. */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
    // Probe with a tiny dummy file; canShare must accept files.
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Triggers a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the click has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Shares an image via the native share sheet when possible, otherwise downloads
 * it. Returns what happened so the caller can surface the right toast. A user
 * cancelling the share sheet resolves to `'cancelled'` (not an error).
 */
export async function shareOrSaveImage(
  blob: Blob,
  fileName: string,
  shareText?: string,
): Promise<ShareResult> {
  if (canShareFiles()) {
    const file = new File([blob], fileName, { type: blob.type || 'image/png' });
    try {
      await navigator.share({
        files: [file],
        ...(shareText ? { text: shareText } : {}),
      });
      return 'shared';
    } catch (err) {
      // AbortError = the user dismissed the sheet; treat as a no-op.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other failure: fall back to a download so the user still gets it.
      downloadBlob(blob, fileName);
      return 'downloaded';
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}
