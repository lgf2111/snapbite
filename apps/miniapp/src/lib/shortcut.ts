/**
 * The signed iOS Shortcut template, served from this app (public/shortcut/).
 *
 * It holds the four actions (Take Photo, Convert Image to JPEG, Get Contents of URL,
 * Show Notification) and the header `Authorization: Bearer PASTE_YOUR_TOKEN_HERE`.
 * No token is ever in the file: each person creates their own in Settings and pastes
 * it over PASTE_YOUR_TOKEN_HERE after adding it.
 *
 * The file is NOT linked to directly inside the installed app: navigating a PWA to it
 * puts a Files-style preview over the whole screen with no way back. On iOS the
 * Shortcuts URL scheme hands the file to the Shortcuts app instead, and the person
 * returns here afterwards. The plain https link is the fallback for other devices,
 * and is shown as text so it can be copied.
 */
export const SHORTCUT_FILE_URL =
  'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut';
export const SHORTCUT_NAME = 'SnapBite Log Meal';

/** `shortcuts://import-shortcut?url=<file>&name=SnapBite%20Log%20Meal` */
export function shortcutImportUrl(file: string = SHORTCUT_FILE_URL): string {
  return `shortcuts://import-shortcut?url=${encodeURIComponent(file)}&name=${encodeURIComponent(SHORTCUT_NAME)}`;
}

/** What the person has to replace in the shortcut, and where. Shown verbatim in the card. */
export const SHORTCUT_TOKEN_FIELD = 'Authorization';
export const SHORTCUT_TOKEN_PLACEHOLDER = 'PASTE_YOUR_TOKEN_HERE';
