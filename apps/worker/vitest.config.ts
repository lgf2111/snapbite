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
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
