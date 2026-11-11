#!/usr/bin/env node
/**
 * Deploy guard: a production bundle must call the API on its own origin.
 *
 * A Worker URL compiled into the client makes every request cross-site, so the
 * session cookie is third-party and iOS Safari drops it, and the Pages Function
 * proxy (functions/api/[[path]].ts) is never used. This fails the deploy if any
 * built script still contains a workers.dev address.
 *
 * usage: node scripts/check-bundle.mjs [assetsDir]   (default: dist/assets)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist/assets';
const offenders = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.js')) continue;
  const text = readFileSync(join(dir, file), 'utf8');
  const hit = text.match(/[a-z0-9.-]*workers\.dev/i);
  if (hit) offenders.push(`${file}: ${hit[0]}`);
}

if (offenders.length > 0) {
  const list = offenders.join('\n  ');
  console.error(`\nABORT: the built bundle contains a workers.dev address:\n  ${list}\n`);
  console.error(
    'Production must call /api on its own origin. Build with `pnpm build:prod` (no VITE_WORKER_URL).',
  );
  process.exit(1);
}
console.log('bundle is same-origin: no workers.dev address ✓');
