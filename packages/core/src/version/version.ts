/**
 * App version + changelog, the single source of truth for update broadcasts.
 * Bump `APP_VERSION` and prepend a {@link ChangelogEntry} for each release; the
 * admin `/broadcast` command sends the CURRENT entry to users.
 */

export interface ChangelogEntry {
  /** Semantic-ish version string, e.g. "0.5.0". */
  version: string;
  /** ISO date (YYYY-MM-DD) of the release. */
  date: string;
  /** Short, user-facing bullet points describing what changed. */
  notes: string[];
}

/**
 * Newest first. The first entry is the current release ({@link APP_VERSION}).
 * Keep notes concise and user-facing (no internal jargon).
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.18.0',
    date: '2026-09-16',
    notes: [
      '🚚 We’ve moved! FoodLog is now SnapBite, on a brand-new bot',
      '👉 Continue here: https://t.me/SnapBiteAI_bot — just tap it and press Start',
      'Your meals, targets, settings and AI key all carry over automatically — nothing to re-enter',
      'This old bot will stop working soon, so switch over now',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-09-16',
    notes: [
      '👋 FoodLog is now SnapBite — same bot, same chat, all your history is right here',
      'Nothing to do: keep sending photos to this chat as usual',
      'Snap a nutrition label or barcode for exact product nutrition',
      'Per-meal reminders + reply to a logged meal to update it',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-09-16',
    notes: [
      'Snap a nutrition label and I read the exact values off it',
      'Barcodes are looked up for exact product nutrition when available',
      'Meal reminders you can set per meal (breakfast/lunch/dinner)',
      'Reply to a logged meal with a change and I update it',
    ],
  },
];

/** The current app version (the newest changelog entry's version). */
export const APP_VERSION: string = CHANGELOG[0]?.version ?? '0.0.0';

/** The current changelog entry (what `/broadcast` sends). */
export const CURRENT_CHANGELOG: ChangelogEntry | undefined = CHANGELOG[0];

/**
 * Builds the user-facing update notification for a changelog entry. Frames it
 * as a beta with frequent updates, lists the notes, and stamps the version so
 * an edited-in-place message clearly shows the latest.
 */
export function broadcastMessage(entry: ChangelogEntry): string {
  const bullets = entry.notes.map((n) => `• ${n}`).join('\n');
  return [
    `🚀 SnapBite update — v${entry.version}`,
    '',
    bullets,
    '',
    "You're an early beta user, so expect frequent updates and improvements. Thanks for helping shape SnapBite! Send /feedback anytime.",
  ].join('\n');
}
