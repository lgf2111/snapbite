import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Migrations that rebuild a parent table must not delete its children.
 *
 * D1 enforces foreign keys, and `DROP TABLE` on a parent is a delete: every row
 * with `ON DELETE CASCADE` pointing at it goes too. 0015 rebuilt `users` and wiped
 * every meal. These tests replay the history on an empty database with real rows
 * in place before the risky migration runs.
 */

const upTo = (name: string) => {
  const all = env.TEST_MIGRATIONS;
  const i = all.findIndex((m) => m.name.startsWith(name));
  expect(i, `${name} exists`).toBeGreaterThan(-1);
  return { before: all.slice(0, i), it: all[i] as (typeof all)[number] };
};

const count = async (table: string) =>
  (await env.MIGRATION_DB.prepare(`select count(*) n from ${table}`).first<{ n: number }>())?.n;

describe('0015 rebuilds users without deleting what hangs off it', () => {
  it('keeps meals, food items, nutrition, settings and the other children', async () => {
    const db = env.MIGRATION_DB;
    const { before, it: rebuild } = upTo('0015');
    await applyD1Migrations(db, before);

    await db.batch([
      db.prepare("insert into users (id, telegram_user_id, created_at) values ('u1', 42, 1)"),
      db.prepare(
        "insert into settings (user_id, ai_provider, updated_at) values ('u1', 'openai', 1)",
      ),
      db.prepare(
        "insert into meals (id, user_id, created_at, logged_at) values ('m1', 'u1', 1, 1)",
      ),
      db.prepare("insert into food_items (id, meal_id, name) values ('f1', 'm1', 'rice')"),
      db.prepare(
        "insert into nutrition (meal_id, energy_kcal, protein_g, carbs_g, fat_g, source) values ('m1', 500, 10, 60, 5, 'ai')",
      ),
      db.prepare(
        "insert into saved_meals (id, user_id, label, meal_json, created_at) values ('sv1', 'u1', 'x', '{}', 1)",
      ),
      db.prepare(
        "insert into device_tokens (id, user_id, token_hash, created_at) values ('d1', 'u1', 'h', 1)",
      ),
      db.prepare(
        "insert into sessions (id, user_id, token_hash, created_at, expires_at) values ('s1', 'u1', 'h', 1, 2)",
      ),
    ]);

    await applyD1Migrations(db, [...before, rebuild]);

    for (const table of [
      'users',
      'settings',
      'meals',
      'food_items',
      'nutrition',
      'saved_meals',
      'device_tokens',
      'sessions',
    ]) {
      expect(await count(table), table).toBe(1);
    }
    // And the rebuild did what it was for: a user may now have no Telegram id.
    await db.prepare("insert into users (id, created_at) values ('u2', 2)").run();
    expect(await count('users')).toBe(2);
  });
});
