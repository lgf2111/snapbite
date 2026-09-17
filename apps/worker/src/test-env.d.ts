declare module 'cloudflare:test' {
  import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';

  interface ProvidedEnv {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    ENCRYPTION_KEY?: string;
    MINI_APP_URL?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
    ADMIN_TELEGRAM_ID?: string;
    TEST_MIGRATIONS: D1Migration[];
  }
  export const env: ProvidedEnv;
  export function applyD1Migrations(db: D1Database, migrations: D1Migration[]): Promise<void>;
}
