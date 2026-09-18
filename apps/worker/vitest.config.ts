import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrations = await readD1Migrations(join(here, 'migrations'));

  return {
    test: {
      include: ['src/**/*.test.ts'],
      setupFiles: ['./src/test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TELEGRAM_BOT_TOKEN: '123456:LOCAL-DEV-BOT-TOKEN',
              // 32-byte AES key, base64, for BYOK encryption in tests.
              ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
              MINI_APP_URL: 'https://app.example.com',
              TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
              // Owner id for admin-gated commands + DM alerts (see §14 tests).
              ADMIN_TELEGRAM_ID: '999000',
              // Force the group-routing vars OFF in tests (independent of
              // .dev.vars) so alerts DM the admin id, which the §14 tests assert.
              // A dedicated test in §17 sets these to verify group routing.
              ADMIN_GROUP_CHAT_ID: '',
              ERRORS_THREAD_ID: '',
              FEEDBACK_THREAD_ID: '',
              BROADCAST_THREAD_ID: '',
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
