/**
 * Sharing/saving an in-memory image blob.
 *
 * Telegram's native `downloadFile` only accepts public HTTPS URLs, not the
 * `blob:` URL of a canvas-generated image, so we rely on standard web APIs:
 *  - Web Share API with a File (`navigator.share`) opens the OS share sheet
 *    (Instagram, Save Image, etc.). This works on mobile, including inside the
 *    Telegram webview on modern iOS/Android.
 *  - Where file sharing isn't supported (desktop browsers, or a file the
 *    browser refuses), we fall back to a normal download of the blob.
 */

/** The image MIME type the shared file advertises, with a matching extension. */
function fileType(blob: Blob): { type: string; ext: string } {
  if (blob.type === 'image/png') return { type: 'image/png', ext: '.png' };
  return { type: 'image/jpeg', ext: '.jpg' };
}

/**
 * Builds the `File` handed to the OS. iOS only draws a preview thumbnail when
 * the name carries an extension and the type is concrete, so both are set here
 * rather than trusting the caller.
 */
function shareFile(blob: Blob, fileName: string): File {
  const { type, ext } = fileType(blob);
  const name = /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}${ext}`;
  return new File([blob], name, { type });
}

/** Whether the browser can share this exact file, not just files in general. */
function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
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
  const file = shareFile(blob, fileName);
  if (canShareFile(file)) {
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
      downloadBlob(blob, file.name);
      return 'downloaded';
    }
  }
  downloadBlob(blob, file.name);
  return 'downloaded';
}
