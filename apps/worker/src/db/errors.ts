import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { errorLogs, type ErrorLogRow } from './schema.js';

export function createErrorsDb(d1: D1Database) {
  return drizzle(d1, { schema: { errorLogs } });
}

export type ErrorsDb = ReturnType<typeof createErrorsDb>;

/** Data for a single logged error. `message`/`detail` must never contain secrets. */
export interface ErrorEvent {
  telegramUserId?: number | null;
  source: string;
  kind?: string;
  status?: number | null;
  message: string;
  detail?: string | null;
}

/** Max characters we persist for a detail blob (keeps rows small). */
const DETAIL_CAP = 2000;

/**
 * Records an error to D1. Best-effort: this NEVER throws into the caller — a
 * logging failure must not turn into a second user-facing error. Also mirrors
 * to `console.error` so `wrangler tail` still shows it live.
 *
 * NOTE (Sentry hook): this is the single choke-point for error reporting. If we
 * ever add Sentry (or any external tracker), capture it here — no other code
 * needs to change.
 */
export async function logError(d1: D1Database, evt: ErrorEvent): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.error('[error_log]', evt.source, evt.kind ?? '', evt.message, evt.detail ?? '');
    const db = createErrorsDb(d1);
    await db.insert(errorLogs).values({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      telegramUserId: evt.telegramUserId ?? null,
      source: evt.source,
      kind: evt.kind ?? 'unhandled',
      status: evt.status ?? null,
      message: evt.message.slice(0, DETAIL_CAP),
      detail: evt.detail ? evt.detail.slice(0, DETAIL_CAP) : null,
    });
  } catch (err) {
    // Swallow — never let logging break the request.
    // eslint-disable-next-line no-console
    console.error('[error_log] failed to persist', err);
  }
}

/** Most recent error rows, newest first. */
export async function recentErrors(d1: D1Database, limit = 10): Promise<ErrorLogRow[]> {
  try {
    const db = createErrorsDb(d1);
    return await db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(limit);
  } catch {
    return [];
  }
}

/**
 * Normalizes an unknown thrown value into `{ message, detail, kind, status }`
 * suitable for `logError`, pulling AIProviderError fields when present.
 */
export function describeError(err: unknown): {
  message: string;
  detail?: string;
  kind?: string;
  status?: number;
} {
  if (err && typeof err === 'object') {
    const anyErr = err as {
      message?: unknown;
      kind?: unknown;
      status?: unknown;
      stack?: unknown;
      name?: unknown;
    };
    const message =
      typeof anyErr.message === 'string' && anyErr.message
        ? anyErr.message
        : String(err);
    const kind =
      typeof anyErr.kind === 'string'
        ? anyErr.kind
        : typeof anyErr.name === 'string'
          ? anyErr.name
          : undefined;
    const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
    const detail = typeof anyErr.stack === 'string' ? anyErr.stack : undefined;
    return { message, detail, kind, status };
  }
  return { message: String(err) };
}
