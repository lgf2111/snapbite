# Running your own SnapBite

SnapBite is a Cloudflare Worker (API + Telegram webhook), a D1 database, and a
Telegram Mini App on Cloudflare Pages. This is the from-zero path.

> **Honesty note:** these steps are derived from this repo's own configuration
> (`apps/worker/wrangler.toml`, the deploy scripts, and the code). The hosted
> instance runs exactly this way, but this document has not been re-executed as a
> clean-room install on a fresh Cloudflare account. If a step has drifted, the
> file it comes from is named — fix the doc, not your setup.

## 0. What you need

- Node 20+ and pnpm 12.4.2 (`corepack enable` or `npm i -g pnpm@12.4.2`)
- A Cloudflare account with Workers, D1 and Pages enabled
- A Telegram bot from [@BotFather](https://t.me/BotFather) — its token
- `npx wrangler login` done once on your machine

Nothing here needs a paid Cloudflare plan; D1, Workers and Pages all have free tiers.

## 1. Install and check the build

```bash
git clone https://github.com/lgf2111/snapbite.git
cd snapbite
pnpm install
pnpm --filter @snapbite/core build
pnpm -r test          # expect all suites green before you deploy anything
```

## 2. Create the database

```bash
cd apps/worker
npx wrangler d1 create snapbite-db
```

Copy the printed `database_id` into `apps/worker/wrangler.toml` under
`[[d1_databases]]`, and change `database_name` if you named it differently.

Apply the schema (the migrations in `apps/worker/migrations/` are the truth):

```bash
npx wrangler d1 migrations apply snapbite-db --remote
```

For local `wrangler dev`, the same migrations run with `--local`.

## 3. Set the secrets

Start from `apps/worker/.env.example` — it documents each value. In production
they are Worker secrets, not a file:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
npx wrangler secret put ENCRYPTION_KEY       # base64 of 32 random bytes; see the example file
npx wrangler secret put MINI_APP_URL         # https://your-mini-app-domain
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ADMIN_TELEGRAM_ID    # your numeric id, gates /stats
```

`ENCRYPTION_KEY` encrypts every stored user API key. Set it once, keep it
stable, and back it up: rotate it and every user has to re-enter their key.

For local development, `cp apps/worker/.env.example apps/worker/.dev.vars` and
fill it in — `wrangler dev` reads that file.

## 4. Deploy the Worker

```bash
pnpm --filter @snapbite/worker deploy
```

Note the URL it prints (`https://snapbite-worker.<subdomain>.workers.dev`) — the
Mini App needs it in the next step.

## 5. Point Telegram at the Worker

Register the webhook, passing the same secret you stored above:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://snapbite-worker.<subdomain>.workers.dev/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

Check it with `getWebhookInfo` — `last_error_message` should be empty. The error
and reminder crons are declared in `wrangler.toml` and deploy with the Worker.

## 6. Deploy the Mini App

The Mini App must be built with the Worker URL baked in — the deploy script
refuses to deploy a bundle that lacks it (that check exists because a bundle
built without it silently runs in local mode):

```bash
cd apps/miniapp
VITE_WORKER_URL=https://snapbite-worker.<subdomain>.workers.dev pnpm deploy
```

Or point it at your own domain: deploy to Pages (`--project-name=<yours>`), then
attach a custom domain in the Cloudflare dashboard. Set `MINI_APP_URL` to that
final HTTPS URL so the bot's button opens the right place.

## 7. Set the bot's profile and commands

Both scripts read `TELEGRAM_BOT_TOKEN` from the environment or a `.bot-token`
file at the repo root:

```bash
cd apps/worker
pnpm bot:profile     # About + the pre-Start description
pnpm bot:commands    # the / command menu
```

Edit the copy inside `scripts/set-bot-profile.mjs` and
`scripts/set-bot-commands.mjs` first if you are running your own branding.

## 8. Prove it works

1. Open your bot, press Start.
2. Send `/setup`, answer the questions, or skip it.
3. Add an AI key in the Mini App (Settings), or log a meal by hand with no key.
4. Send a photo of food. You should get an "Analyzing…" message that is edited
   into the result, and the meal should appear in the Mini App.

If the Mini App opens but every call fails, the usual cause is a Mini App built
without `VITE_WORKER_URL`, or a Worker deployed before step 3's secrets were set.

## 9. Optional: your own branding

- Bot name/handle: [@BotFather](https://t.me/BotFather).
- Copy: `packages/core/src/version/version.ts` (user-facing changelog) and the
  static pages in `apps/miniapp/public/`.
- The hosted SnapBite name, logo and bot handle are **not** part of the licence
  (see `LICENSE`) — use your own.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot never replies | webhook not set, or `secret_token` mismatch (check `getWebhookInfo`) |
| `/stats` silent | `ADMIN_TELEGRAM_ID` unset or not your numeric id — the command is invisible to non-admins by design |
| "Add your AI key first" for everyone | expected until each user saves a key; they can still log by hand |
| Mini App loads but no data | built without `VITE_WORKER_URL`, or wrong `MINI_APP_URL` |
| Keys stop decrypting after a redeploy | `ENCRYPTION_KEY` changed — restore the original |
| Photo analysis 503s | provider overload or region block; a fallback provider in Settings fixes it |
