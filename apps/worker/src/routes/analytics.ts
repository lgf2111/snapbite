import { Hono } from 'hono';
import { createAnalyticsDb, getAnalytics } from '../db/analytics.js';
import type { AppBindings } from '../env.js';

/** Analytics routes. All figures come from aggregate SQL — no AI calls. */
export function analyticsRoutes() {
  const app = new Hono<AppBindings>();

  // GET /api/analytics?days=30
  app.get('/', async (c) => {
    const daysParam = Number(c.req.query('days'));
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 30;
    const db = createAnalyticsDb(c.env.DB);
    const summary = await getAnalytics(db, c.get('userId'), days);
    return c.json({ days, ...summary });
  });

  return app;
}
