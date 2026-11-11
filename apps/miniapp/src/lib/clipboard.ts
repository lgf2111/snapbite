/**
 * Copy text to the clipboard. Resolves false when the Clipboard API is missing
 * or refuses (installed iOS apps sometimes do), and then selects `fallback` so
 * a long-press still offers Copy.
 */
export async function copyText(text: string, fallback?: HTMLElement | null): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return false;
  }
}
