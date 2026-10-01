#!/usr/bin/env node
/**
 * Sets the bot's public profile text with Telegram:
 *   - About       (setMyShortDescription) — the short line on the bot's profile
 *                 page and in share previews. Max 120 chars.
 *   - Description  (setMyDescription)      — the "What can this bot do?" text shown
 *                 on the empty-chat screen before a user taps Start. Max 512 chars.
 *
 * (Telegram's naming is the usual gotcha: the profile "About" line is the API's
 *  *short* description; the pre-Start "Description" is the API's description.)
 *
 * The token is read from (in order):
 *   1. the TELEGRAM_BOT_TOKEN environment variable, or
 *   2. a `.bot-token` file at the repo root (gitignored).
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=123:abc node apps/worker/scripts/set-bot-profile.mjs
 *   # or, with a .bot-token file at the repo root:
 *   node apps/worker/scripts/set-bot-profile.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** About line — bot profile page + share previews. Telegram limit: 120 chars. */
const ABOUT = 'Snap your food. AI logs the calories and macros. Your key, your data.';

/** Pre-Start "What can this bot do?" text. Telegram limit: 512 chars. */
const DESCRIPTION = `Snap a meal → AI estimates calories, protein, carbs & fat → logged. No searching databases.

• Reply "add a coke" or "rice was double" to correct it
• Reads nutrition labels & barcodes
• Set goals & see daily progress in the Mini App
• Runs on your own AI key — ~free to use
• Every value is an editable estimate; your data stays yours

Send a meal photo to begin.`;

const ABOUT_MAX = 120;
const DESCRIPTION_MAX = 512;

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

async function callApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error(`${method} failed:`, JSON.stringify(body));
    process.exit(1);
  }
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error(
      'No bot token found. Set TELEGRAM_BOT_TOKEN or create a .bot-token file at the repo root.',
    );
    process.exit(1);
  }

  if (ABOUT.length > ABOUT_MAX) {
    console.error(`About is ${ABOUT.length} chars; Telegram's limit is ${ABOUT_MAX}.`);
    process.exit(1);
  }
  if (DESCRIPTION.length > DESCRIPTION_MAX) {
    console.error(
      `Description is ${DESCRIPTION.length} chars; Telegram's limit is ${DESCRIPTION_MAX}.`,
    );
    process.exit(1);
  }

  // About → setMyShortDescription; Description → setMyDescription.
  await callApi(token, 'setMyShortDescription', { short_description: ABOUT });
  await callApi(token, 'setMyDescription', { description: DESCRIPTION });

  console.log('✅ Bot profile updated:');
  console.log(`   About (${ABOUT.length}/${ABOUT_MAX}): ${ABOUT}`);
  console.log(`   Description (${DESCRIPTION.length}/${DESCRIPTION_MAX}):`);
  for (const line of DESCRIPTION.split('\n')) console.log(`     ${line}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
