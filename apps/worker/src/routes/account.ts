import { Hono } from 'hono';
import { createAccountDb, deleteAccount, streamUserExport } from '../db/account.js';
import type { AppBindings } from '../env.js';
import { r2Store } from '../storage/photos.js';

/**
 * Account/data-control routes. All owner-scoped via the auth middleware's
 * `userId`. The export never includes the encrypted API key.
 */
export function accountRoutes() {
  const app = new Hono<AppBindings>();

  // GET /api/account/export — full JSON export of the user's data.
  // Sent as an attachment so Telegram's downloadFile / a browser save it with
  // a sensible filename instead of rendering it inline.
  app.get('/export', async (c) => {
    const db = createAccountDb(c.env.DB);
    const stream = await streamUserExport(db, c.get('userId'));
    if (!stream) return c.json({ error: 'Not found' }, 404);
    const filename = `snapbite-export-${new Date().toISOString().slice(0, 10)}.json`;
    return c.body(stream, 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    });
  });

  // DELETE /api/account — permanently delete the user and all their data.
  app.delete('/', async (c) => {
    const db = createAccountDb(c.env.DB);
    const userId = c.get('userId');
    // Collect object keys before the rows vanish, then purge the bytes.
    const keys = await deleteAccount(db, userId);
    const store = r2Store(c.env.PHOTOS);
    if (store && keys) {
      for (const key of keys) {
        await store.delete(key).catch(() => {});
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
