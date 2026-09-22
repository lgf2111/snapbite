import { Hono } from 'hono';
import { createAccountDb, deleteAccount, exportUser } from '../db/account.js';
import type { AppBindings } from '../env.js';

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
    const data = await exportUser(db, c.get('userId'));
    if (!data) return c.json({ error: 'Not found' }, 404);
    const filename = `snapbite-export-${new Date().toISOString().slice(0, 10)}.json`;
    return c.body(JSON.stringify(data, null, 2), 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    });
  });

  // DELETE /api/account — permanently delete the user and all their data.
  app.delete('/', async (c) => {
    const db = createAccountDb(c.env.DB);
    await deleteAccount(db, c.get('userId'));
    return c.json({ ok: true });
  });

  return app;
}
