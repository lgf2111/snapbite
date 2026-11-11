/**
 * The signed iOS Shortcut template, served from this app (public/shortcut/).
 *
 * It holds the four actions (Take Photo, Convert Image to JPEG, Get Contents of URL,
 * Show Notification) and the header `Authorization: Bearer PASTE_YOUR_TOKEN_HERE`.
 * No token is ever in the file: each person creates their own in Settings and pastes
 * it over PASTE_YOUR_TOKEN_HERE after adding it.
 *
 * It is linked with a plain https anchor. The `shortcuts://import-shortcut?url=` scheme
 * was tried and rejected on iOS 26 ("The shortcut URL provided was invalid"), so do not
 * bring it back. Opening the file shows a preview with "Open in Shortcuts".
 */
export const SHORTCUT_FILE_URL =
  'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut';

/**
 * Apple's own share link (https://www.icloud.com/shortcuts/...). Empty until the shortcut
 * is published to iCloud; once set the card leads with it, because that link opens a
 * proper import screen with a Get Shortcut button instead of a file preview.
 */
export const SHORTCUT_ICLOUD_URL = '';

/** What the person has to replace in the shortcut, and where. Shown verbatim in the card. */
export const SHORTCUT_TOKEN_FIELD = 'Authorization';
export const SHORTCUT_TOKEN_PLACEHOLDER = 'PASTE_YOUR_TOKEN_HERE';
