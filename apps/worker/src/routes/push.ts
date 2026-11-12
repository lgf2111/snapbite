import { Hono } from 'hono';
import {
  createPushDb,
  deleteSubscriptionForUser,
  listSubscriptions,
  upsertSubscription,
} from '../db/push.js';
import type { AppBindings } from '../env.js';
import { pushToUser } from '../push/deliver.js';
import { b64urlDecode } from '../push/send.js';
import { TEST_PUSH } from '../reminders.js';

/**
 * Hosts that run browser push services. The Worker POSTs to whatever endpoint it
 * is given, so accepting any URL would let a signed-in user aim it at an
 * arbitrary server. Browsers only ever hand out endpoints on these.
 */
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

function decodesTo(text: unknown, length: number, firstByte?: number): text is string {
  if (typeof text !== 'string' || text.length > 200) return false;
  try {
    const bytes = b64urlDecode(text);
    return bytes.length === length && (firstByte === undefined || bytes[0] === firstByte);
  } catch {
    return false;
  }
}

/**
 * Web push routes. Mounted under `/api`, behind `accountAuth`, so every query is
 * scoped to the caller's `userId`.
 *
 *   GET  /api/push/key          -> { key }   the VAPID public key to subscribe with
 *   POST /api/push/subscribe    { endpoint, keys: { p256dh, auth } }
 *   POST /api/push/unsubscribe  { endpoint }
 *   POST /api/push/test         -> sends one notification to the caller's devices
 */
export function pushRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/key', (c) => {
    const key = c.env.PUSH_VAPID_PUBLIC_KEY?.trim();
    if (!key) return c.json({ error: 'Not configured', detail: 'Push is not set up' }, 503);
    return c.json({ key });
  });

  app.post('/subscribe', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    } | null;
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;

    if (!isPushEndpoint(endpoint)) {
      return c.json({ error: 'Bad request', detail: 'Not a push service endpoint' }, 400);
    }
    // A 65-byte uncompressed P-256 point, and a 16-byte secret: anything else
    // could never be encrypted to.
    if (!decodesTo(p256dh, 65, 0x04) || !decodesTo(auth, 16)) {
      return c.json({ error: 'Bad request', detail: 'Invalid subscription keys' }, 400);
    }

    const id = await upsertSubscription(createPushDb(c.env.DB), {
      userId: c.get('userId'),
      endpoint,
      p256dh,
      auth,
      userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
    });
    return c.json({ ok: true, id });
  });

  app.post('/unsubscribe', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (typeof body?.endpoint !== 'string') {
      return c.json({ error: 'Bad request', detail: 'endpoint is required' }, 400);
    }
    // Same answer whether or not it was theirs: no probing for other people's endpoints.
    const removed = await deleteSubscriptionForUser(
      createPushDb(c.env.DB),
      c.get('userId'),
      body.endpoint,
    );
    return c.json({ ok: true, removed });
  });

  app.post('/test', async (c) => {
    const db = createPushDb(c.env.DB);
    const userId = c.get('userId');
    if ((await listSubscriptions(db, userId)).length === 0) {
      return c.json({ ok: false, sent: 0, detail: 'No device is subscribed' }, 409);
    }
    const summary = await pushToUser(
      db,
      userId,
      {
        ...TEST_PUSH,
        url: '/',
        tag: 'snapbite-test',
      },
      c.env,
    );
    return c.json({
      ok: summary.delivered > 0,
      delivered: summary.delivered,
      failed: summary.failed,
      removed: summary.removed,
      live: summary.live,
    });
  });

  return app;
}
