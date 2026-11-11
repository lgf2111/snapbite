/**
 * The signed iOS Shortcut template, served from this app (public/shortcut/).
 *
 * It holds the four actions (Take Photo, Convert Image to JPEG, Get Contents of URL,
 * Show Notification) and the header `Authorization: Bearer PASTE_YOUR_TOKEN_HERE`.
 * No token is ever in the file: each person creates their own in Settings and pastes
 * it over PASTE_YOUR_TOKEN_HERE after adding it. It is linked with a plain anchor so
 * iOS itself hands it to Shortcuts; do not fetch it or wrap it in a blob.
 */
export const SHORTCUT_TEMPLATE_URL = '/shortcut/snapbite-log-meal.shortcut';

/** What the person has to replace in the shortcut, and where. Shown verbatim in the card. */
export const SHORTCUT_TOKEN_FIELD = 'Authorization';
export const SHORTCUT_TOKEN_PLACEHOLDER = 'PASTE_YOUR_TOKEN_HERE';
