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
    version: '0.22.0',
    date: '2026-10-08',
    notes: [
      '🌾 Fiber is now tracked — SnapBite estimates dietary fiber per food and shows it on the meal and in the log reply',
      '📊 Goal progress on every log — if you’ve set a goal, each logged meal tells you where you are for the day (e.g. “96g protein today — 54g to your goal”)',
      'Both are estimates and fully editable, as always',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-10-01',
    notes: [
      '⭐ Save a meal in the app, then re-log it from chat anytime — send /saved to list them, /saved 1 to log one again (no photo needed)',
      '📅 Weekly view now toggles between a 7-day total and your daily average, so you can compare a typical day to your target',
      '📸 More reliable photo logging — if the AI’s first read comes back garbled, SnapBite quietly retries once so you don’t have to resend',
      '🎯 Onboarding is lighter — skip the profile and just start logging; add a goal whenever you want the progress rings',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-09-16',
    notes: [
      '🛑 Final notice: this old bot is being shut down TODAY and will stop working',
      '👉 Continue on our new bot — open it and press Start: https://t.me/SnapBiteAI_bot',
      'All your meals, targets, settings and AI key are already there — nothing to re-enter',
      'Thanks for being an early user — see you on @SnapBiteAI_bot! 💙',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-09-16',
    notes: [
      '✅ We’ve moved! SnapBite now lives on a new bot: @SnapBiteAI_bot',
      '👉 Open it now and press Start: https://t.me/SnapBiteAI_bot',
      'Your meals, targets, settings and AI key are already there — nothing to re-enter',
      '⚠️ This old bot is being retired and will stop working — please switch over now',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-09-16',
    notes: [
      '🔧 Heads up: we’re moving SnapBite to a new home over the next little while',
      '⏳ Expect brief downtime — if a photo doesn’t log, wait a bit and try again',
      '👉 We’re moving to a new bot: @SnapBiteAI_bot — please open it and press Start',
      'Your meals, targets, settings and AI key all come with you automatically',
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

/** One version block (header + bullets) for a stacked, edited-in-place message. */
function versionBlock(entry: ChangelogEntry): string {
  const bullets = entry.notes.map((n) => `• ${n}`).join('\n');
  return [`🚀 v${entry.version}`, bullets].join('\n');
}

/**
 * Builds the broadcast message for an edit-in-place update that should GROW
 * rather than replace: it stacks every changelog entry newer than
 * `sinceVersion` (newest first), up to and including the current release, under
 * one header. This way a user whose previous update message is still editable
 * sees the new release(s) APPENDED to the ones already shown, instead of the
 * message being rewritten to only the latest.
 *
 * - `sinceVersion` = the version currently shown in that user's message. Entries
 *   strictly newer than it are included (so already-shown ones aren't dropped,
 *   and the one they're already on isn't duplicated as "new").
 * - When `sinceVersion` is missing or not found in the changelog, this falls
 *   back to a single current-entry message (same as a fresh send).
 *
 * NOTE: because we stack from the full {@link CHANGELOG}, the result is
 * deterministic and can't double-count — re-running with the same `sinceVersion`
 * produces the same text.
 */
export function broadcastMessageSince(sinceVersion: string | null | undefined): string {
  const current = CHANGELOG[0];
  if (!current) return '';

  // Index of the version the message currently shows; entries BEFORE it (newer)
  // are the ones to stack. If unknown, just send the current entry.
  const sinceIdx = sinceVersion ? CHANGELOG.findIndex((e) => e.version === sinceVersion) : -1;
  const newer = sinceIdx > 0 ? CHANGELOG.slice(0, sinceIdx) : [current];

  // Single entry → use the standard single-version message (keeps existing look).
  if (newer.length <= 1) return broadcastMessage(newer[0] ?? current);

  const blocks = newer.map(versionBlock).join('\n\n');
  return [
    '🚀 SnapBite updates',
    '',
    blocks,
    '',
    "You're an early beta user, so expect frequent updates and improvements. Thanks for helping shape SnapBite! Send /feedback anytime.",
  ].join('\n');
}
