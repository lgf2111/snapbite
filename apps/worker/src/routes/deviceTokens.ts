import { Hono } from 'hono';
import {
  createDeviceToken,
  createDeviceTokensDb,
  hashDeviceToken,
  listDeviceTokens,
  mintDeviceToken,
  revokeAllDeviceTokens,
  revokeDeviceToken,
} from '../db/deviceTokens.js';
import type { AppBindings } from '../env.js';

const DEFAULT_LABEL = 'iOS Shortcut';
const MAX_LABEL = 60;

/**
 * Device-token management for the signed-in account (the PWA's "One-tap
 * logging" card). Mounted under `/api`, so `accountAuth` has already set
 * `userId`; every query is scoped to it. The raw token is returned once by POST
 * and never stored or listed — only its SHA-256 hash is persisted.
 */
export function deviceTokenRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const tokens = await listDeviceTokens(createDeviceTokensDb(c.env.DB), c.get('userId'), {
      includeRevoked: c.req.query('includeRevoked') === '1',
    });
    return c.json({ tokens });
  });

  app.post('/', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown } | null;
    const rawLabel = body?.label;
    if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
      return c.json({ error: 'Invalid label' }, 400);
    }
    const label = (rawLabel ?? '').trim() || DEFAULT_LABEL;
    if (label.length > MAX_LABEL) {
      return c.json({ error: 'Invalid label', detail: `Max ${MAX_LABEL} characters` }, 400);
    }

    const token = mintDeviceToken();
    const createdAt = Date.now();
    const id = await createDeviceToken(createDeviceTokensDb(c.env.DB), {
      userId: c.get('userId'),
      tokenHash: await hashDeviceToken(token),
      label,
      now: createdAt,
    });
    return c.json({ id, token, label, createdAt }, 201);
  });

  app.delete('/', async (c) => {
    const revoked = await revokeAllDeviceTokens(createDeviceTokensDb(c.env.DB), c.get('userId'));
    return c.json({ revoked });
  });

  app.delete('/:id', async (c) => {
    const ok = await revokeDeviceToken(
      createDeviceTokensDb(c.env.DB),
      c.get('userId'),
      c.req.param('id'),
    );
    if (!ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
