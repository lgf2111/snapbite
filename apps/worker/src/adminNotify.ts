import type { BotReply } from '@snapbite/core';
import { type Env, parseAdminId, parseChatId, parseThreadId } from './env.js';

/** The bot-send surface adminNotify needs (a subset of the full client). */
interface Sender {
  sendMessage(chatId: number, reply: BotReply): Promise<{ messageId: number | null }>;
}

/** Which admin concern an alert belongs to (maps to a group Topic). */
export type AdminAlertKind = 'error' | 'feedback' | 'broadcast';

/**
 * Routes an admin alert to the right destination, best-effort (never throws):
 * - If `ADMIN_GROUP_CHAT_ID` is set, posts into that group's Topic for the
 *   given kind (errors/feedback/broadcast thread ids). Group-only when set.
 * - Otherwise DMs `ADMIN_TELEGRAM_ID`.
 * - If neither is configured, it's a no-op.
 */
export async function adminNotify(
  env: Env,
  bot: Sender,
  kind: AdminAlertKind,
  text: string,
): Promise<void> {
  const groupId = parseChatId(env.ADMIN_GROUP_CHAT_ID);
  try {
    if (groupId != null) {
      const threadId = threadForKind(env, kind);
      try {
        await bot.sendMessage(groupId, { text, ...(threadId != null ? { threadId } : {}) });
        return;
      } catch (err) {
        // Posting to the group/topic failed (bot not a member/admin, topic
        // deleted, stale id, …). Surface it in logs (visible via `wrangler
        // tail`) instead of silently dropping it, then fall back to a DM so the
        // owner still gets the alert.
        // eslint-disable-next-line no-console
        console.error('[adminNotify] group post failed', {
          groupId,
          threadId,
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const adminId = parseAdminId(env.ADMIN_TELEGRAM_ID);
    if (adminId != null) {
      await bot.sendMessage(adminId, { text });
    }
  } catch (err) {
    // Alerting must never break the request — but do leave a breadcrumb.
    // eslint-disable-next-line no-console
    console.error('[adminNotify] failed to deliver alert', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The Topic thread id for a given alert kind, or null when not configured. */
function threadForKind(env: Env, kind: AdminAlertKind): number | null {
  switch (kind) {
    case 'error':
      return parseThreadId(env.ERRORS_THREAD_ID);
    case 'feedback':
      return parseThreadId(env.FEEDBACK_THREAD_ID);
    case 'broadcast':
      return parseThreadId(env.BROADCAST_THREAD_ID);
  }
}
