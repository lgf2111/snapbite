# FoodLog

A Telegram-native, low-friction, AI-assisted food & nutrition logging app.

**One-line goal:** unlock phone → open FoodLog (or just send a photo to the bot) → AI analyzes it → confirm/correct → saved.

Nutrition is always shown as an **estimate** and is always **editable**. The AI runs on **your own API key** (BYOK), so running costs are ~$0 beyond a few hundredths of a cent per photo.

## How it works

Send a photo of a meal to the Telegram bot. The Cloudflare Worker downloads it, calls a vision model (your key) to identify foods, portions, and rough nutrition, saves the meal (keeping the photo via its Telegram `file_id`), and replies. A deterministic resolver prefers a bundled per-100g table and falls back to the AI estimate, tagging every value's source (`table` / `ai_estimate` / `manual` / `mixed`). Per-food nutrition (kcal + protein/carbs/fat for every food) is persisted and read back verbatim, so multi-food meals keep each food's macros. In the Mini App you review, edit, search, and analyze — all computed from stored rows in SQL, no AI calls.

**Logging is done through the Telegram bot:** send a photo to the bot chat and it auto-logs the AI's estimate, keeps the photo (free, via the Telegram `file_id`), and replies with an "Open" button. The **Mini App** is for reviewing, editing, searching, and analyzing your logged meals — it no longer captures photos itself, since Mini-App uploads can't retain an image for free.

## Architecture

Monorepo (pnpm workspaces):

- **`packages/core`** — transport-agnostic domain logic: Zod schemas, the `AIProvider` interface + a generic OpenAI-compatible adapter with provider presets (Gemini, OpenAI, DeepSeek), prompt builder, nutrition resolver + bundled table, Telegram `initData` verification, bot update parsing, AES-GCM crypto. Zero platform imports; the reason a future Telegram-native port is cheap.
- **`apps/worker`** — Cloudflare Worker (Hono) + D1 (Drizzle ORM). Auth via Telegram `initData` HMAC, encrypted BYOK, meal analyze/save/CRUD, history/search/analytics, and the bot webhook.
- **`apps/miniapp`** — React + Vite Mini App (`@telegram-apps/sdk-react`), UI built with **shadcn/ui + Tailwind CSS v4**, hosted on Cloudflare Pages. Reviews/edits/searches/analyzes logged meals (logging itself is done via the bot). The Telegram theme drives the shadcn color tokens at runtime. Falls back to localStorage when no backend is configured (browser dev).
- **`apps/cli`** — local harness to run a photo through the pipeline end-to-end (mock by default, real provider via `--real`).

**Security:** the AI key is stored AES-256-GCM encrypted in D1 (ciphertext + IV), decrypted in-memory per request, never returned or logged. Image bytes transit but are not persisted; only the Telegram `file_id` is kept (for bot photos). All meal data is owner-scoped.

## Develop

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm -r test         # run all tests (Vitest; Worker tests use Miniflare D1)
pnpm -r typecheck    # typecheck every package
pnpm -r build        # build all packages
```

Run one workspace, e.g. the Worker locally:

```bash
pnpm --filter @foodlog/worker dev          # wrangler dev (local D1)
pnpm --filter @foodlog/miniapp dev         # Vite dev server (mock mode without VITE_WORKER_URL)
```

Try the pipeline from the CLI:

```bash
pnpm --filter @foodlog/cli build
node apps/cli/dist/index.js path/to/meal.jpg            # mock provider
node --env-file=.env apps/cli/dist/index.js meal.jpg --real   # real provider (needs a key)
```

## Configuration & secrets

Secrets are never committed. Local files are gitignored.

- **Root `.env`** — `DEEPSEEK_API_KEY` (or other provider key) for CLI/real tests.
- **`apps/worker/.dev.vars`** — local Worker secrets: `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY` (base64 of 32 bytes), `MINI_APP_URL`, `TELEGRAM_WEBHOOK_SECRET`.
- **`apps/miniapp` build** — `VITE_WORKER_URL` points the app at the deployed Worker (empty = mock mode).

Production secrets are set with `wrangler secret put` and are not stored in the repo.

## Deploy (Cloudflare, free tier)

```bash
# One-time
wrangler login
wrangler d1 create foodlog-db        # put the id in apps/worker/wrangler.toml
wrangler d1 migrations apply foodlog-db --remote
# Set secrets: TELEGRAM_BOT_TOKEN, ENCRYPTION_KEY, MINI_APP_URL, TELEGRAM_WEBHOOK_SECRET

# Worker
pnpm --filter @foodlog/worker exec wrangler deploy

# Mini App (Pages)
VITE_WORKER_URL=https://<worker-url> pnpm --filter @foodlog/miniapp build
pnpm --filter @foodlog/miniapp exec wrangler pages deploy dist --project-name=foodlog

# Bot: register the webhook (with the secret) and set the Mini App menu button via the Telegram Bot API.
```

## AI providers

FoodLog is provider-agnostic. Pick a provider and paste your key in **Settings**:

- **Google Gemini** (default, recommended) — best food-vision value; free tier at aistudio.google.com. Default model `gemini-3.6-flash` (Gemini rotates/retires model names; override in Settings if needed).
- **OpenAI** — `gpt-4o-mini` by default; strong and reliable.
- **DeepSeek** — cheapest; weaker at food recognition.

All three are called through the same OpenAI-compatible Chat Completions shape; only the base URL, model, and whether `image_url.detail` is honored differ. Image detail defaults to `high` for better recognition. The model is overridable per user (versions rotate).

## Status

The full core build (Tasks 1–12) is done and deployed, plus full CRUD, editable macros, bot-photo auto-log, and photos-in-logs. Multi-provider AI (Gemini / OpenAI / DeepSeek) with in-app provider + model selection is live. Privacy & data control shipped: **export** your data (`GET /api/account/export` → downloadable JSON; the encrypted API key is never included) and **delete** your account (`DELETE /api/account`, cascading to all meals/photos/settings), both surfaced in Settings alongside a plain-language privacy explanation. The Mini App is built on shadcn/ui + Tailwind v4 with Telegram theming, native Back/Main buttons + haptics, swipe-to-delete, toasts, skeletons, empty states, a daily-summary card, and macro icons. See `PLAN.md` §10 for the full progress log and roadmap.
