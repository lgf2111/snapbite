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
  app.get('/export', async (c) => {
    const db = createAccountDb(c.env.DB);
    const data = await exportUser(db, c.get('userId'));
    if (!data) return c.json({ error: 'Not found' }, 404);
    return c.json(data);
  });

  // DELETE /api/account — permanently delete the user and all their data.
  app.delete('/', async (c) => {
    const db = createAccountDb(c.env.DB);
    await deleteAccount(db, c.get('userId'));
    return c.json({ ok: true });
  });

  return app;
}
