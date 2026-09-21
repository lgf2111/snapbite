import { MealResult } from '@snapbite/core';
import { Hono } from 'hono';
import { createFavoritesDb, deleteFavorite, listFavorites, saveFavorite } from '../db/favorites.js';
import type { AppBindings } from '../env.js';

const MAX_LABEL_LEN = 120;

/**
 * Saved meals ("favorites") routes, mounted under /api/favorites (authed).
 *  - GET    /            → list the user's favorites (newest first)
 *  - POST   /            → { meal: MealResult, label? } save a new favorite
 *  - DELETE /:id         → delete an owned favorite
 * A favorite stores the full MealResult so it can be re-logged with no AI call.
 */
export function favoritesRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const db = createFavoritesDb(c.env.DB);
    const favorites = await listFavorites(db, c.get('userId'));
    return c.json({ favorites });
  });

  app.post('/', async (c) => {
    let body: { meal?: unknown; label?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const parsed = MealResult.safeParse(body.meal);
    if (!parsed.success) {
      return c.json(
        { error: 'Bad request', detail: 'Invalid meal', issues: parsed.error.issues },
        400,
      );
    }

    // Label: use the provided one, else derive from the foods.
    const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
    const derived = parsed.data.foods.map((f) => f.food.name).join(', ') || 'Saved meal';
    const label = (rawLabel || derived).slice(0, MAX_LABEL_LEN);

    const db = createFavoritesDb(c.env.DB);
    const id = await saveFavorite(db, { userId: c.get('userId'), label, meal: parsed.data });
    return c.json({ id, label }, 201);
  });

  app.delete('/:id', async (c) => {
    const db = createFavoritesDb(c.env.DB);
    const ok = await deleteFavorite(db, c.req.param('id'), c.get('userId'));
    if (!ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
