import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// Apply generated D1 migrations once before the test suite runs. The migrations
// are injected as the TEST_MIGRATIONS binding by vitest.config.ts.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
