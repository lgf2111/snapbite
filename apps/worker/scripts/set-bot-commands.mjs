#!/usr/bin/env node
/**
 * Registers the bot's command menu with Telegram (setMyCommands), so commands
 * show up in the `/` autocomplete inside the chat.
 *
 * The token is read from (in order):
 *   1. the TELEGRAM_BOT_TOKEN environment variable, or
 *   2. a `.bot-token` file at the repo root (gitignored).
 *
 * Admin-only commands (/errors and the no-arg /feedback review) are deliberately
 * NOT listed here — they stay invisible to normal users and are gated in code by
 * ADMIN_TELEGRAM_ID. `/feedback <text>` is listed for everyone to submit reports.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=123:abc node apps/worker/scripts/set-bot-commands.mjs
 *   # or, with a .bot-token file at the repo root:
 *   node apps/worker/scripts/set-bot-commands.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** The public command menu (what users see under `/`). */
const COMMANDS = [
  { command: 'start', description: 'Get started with SnapBite' },
  { command: 'setup', description: 'Set your goal & targets by chat' },
  { command: 'settings', description: 'Add or update your AI key' },
  { command: 'feedback', description: 'Report a problem or send an idea' },
  { command: 'help', description: 'How SnapBite works' },
];

function resolveToken() {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = readFileSync(join(repoRoot, '.bot-token'), 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {
    /* no file — fall through to the error below */
  }
  return null;
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error(
      'No bot token found. Set TELEGRAM_BOT_TOKEN or create a .bot-token file at the repo root.',
    );
    process.exit(1);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands: COMMANDS }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error('setMyCommands failed:', JSON.stringify(body));
    process.exit(1);
  }
  console.log('✅ Bot command menu updated:');
  for (const c of COMMANDS) console.log(`   /${c.command} — ${c.description}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
