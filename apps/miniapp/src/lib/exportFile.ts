/**
 * Getting the data export out of the app and onto the person's device.
 *
 * An installed web app has no tabs and no way back from a page it was sent to, so
 * the export is never opened as a URL: it is fetched inside the app (with the
 * cookie), turned into a Blob, and saved from here. Where a download cannot be
 * made, the caller shows the JSON itself, so the data is always reachable.
 */

export function exportFileName(now: Date = new Date()): string {
  return `snapbite-export-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Saves `text` as a file through a Blob and a downloaded <a>. Returns false when
 * this browser cannot (no `download` support, or the click throws) so the caller
 * can fall back to showing the data. Cannot tell whether a download that WAS
 * started is later cancelled: nothing reports that.
 */
export function downloadJson(text: string, fileName: string): boolean {
  try {
    const a = document.createElement('a');
    if (!('download' in a)) return false;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoked a little later: some webviews read the blob after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

function asFile(text: string, fileName: string): File {
  return new File([text], fileName, { type: 'application/json' });
}

/** Whether the share sheet can take the export as a file (iOS: the reliable way out of a PWA). */
export function canShareFile(text: string, fileName: string): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [asFile(text, fileName)] })
    );
  } catch {
    return false;
  }
}

/** Whether the share sheet exists at all (it can at least take the text). */
export function canShareAnything(): boolean {
  return typeof navigator.share === 'function';
}

/**
 * Opens the share sheet with the export: as a file where files are accepted,
 * otherwise as text. Must be called from a tap. Resolves false if the person
 * dismissed the sheet, which is not an error.
 */
export async function shareExport(text: string, fileName: string): Promise<boolean> {
  try {
    if (canShareFile(text, fileName)) {
      await navigator.share({ files: [asFile(text, fileName)], title: 'SnapBite export' });
    } else {
      await navigator.share({ title: 'SnapBite export', text });
    }
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
}
