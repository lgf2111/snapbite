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
    version: '0.28.1',
    date: '2026-09-16',
    notes: [
      "🌍 If your AI provider isn't available in your region (common with Gemini), SnapBite now auto-switches to your fallback provider instead of failing",
      'And if you have no fallback set, the error now tells you to switch to OpenAI or DeepSeek in Settings',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-09-16',
    notes: [
      '🍽️ Shared a dish? Tell the bot "divide by 4 pax" (or reply/Update with AI) and it logs just your share',
      'The meal name shows the split too, e.g. "Pizza (1/4 of 4 pax)", so it\u2019s clear only your portion was counted',
      'Still an editable estimate — tweak it anytime',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.27.1',
    date: '2026-09-16',
    notes: [
      '✨ The "Update with AI" button on the Home list now edits right there — type your change, and it applies without opening the meal first',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.27.0',
    date: '2026-09-16',
    notes: [
      '🍽️ One-tap portion fix — when a photo logs with low confidence, tap ¼× · ½× · 1× · 2× to rescale the whole meal instantly',
      "It's pure math on your logged meal — no new AI call, and the message updates in place so you can keep nudging",
      'Portion sizing is where estimates are weakest, so this makes correcting it a single tap',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-09-16',
    notes: [
      '🔥 Logging streaks — log on consecutive days and each confirmation shows your run, with a 🎉 every 7 days',
      "Evening-friendly: a streak that was alive through yesterday won't break until the day ends",
      '📅 Weekly recap (opt-in) — turn it on in Settings and get a short Sunday summary of your week: days logged, average calories & protein, protein-target hits, best day, and your streak',
      'Both are computed from your own logged meals — no AI, always an estimate',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-10-29',
    notes: [
      '🧑‍🍳 Ask your coach — send "/coach am I low on protein today?" and get a quick answer from your own logged data',
      'It reads your today/this-week totals vs your targets and replies in a sentence or two, on your own key',
      'On-demand only, always an estimate',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-10-22',
    notes: [
      '⚖️ Adaptive targets — log your weight ("/weight 72.5" or just "72.5 kg") and SnapBite learns your real daily burn',
      'Each week it compares what you ate to your weight trend and gently tunes your calorie goal to match',
      'Opt in anytime in Settings; it stays an editable estimate and no AI is involved',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-10-15',
    notes: [
      '💬 Log a meal by text — no photo needed! Just describe it: "two eggs, sourdough toast, half an avocado"',
      'Start with "log …" (or "ate …"/"had …") to log a new meal; replying to a meal still edits that meal',
      'Same AI estimate + editable nutrition as photo logging, on your own key',
      'Send /feedback anytime — more coming soon 💙',
    ],
  },
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
