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

# Bot: register the webhook (with the secret) via the Telegram Bot API. The Mini App is set as
# the bot's Main Mini App in BotFather, so it launches from the bot profile's "Open App" button
# (no separate chat menu button needed).
```

## AI providers

FoodLog is provider-agnostic. Pick a provider and paste your key in **Settings**:

- **Google Gemini** (default, recommended) — best food-vision value; free tier at aistudio.google.com. Default model `gemini-3.6-flash` (Gemini rotates/retires model names; override in Settings if needed).
- **OpenAI** — `gpt-4o-mini` by default; strong and reliable.
- **DeepSeek** — cheapest; weaker at food recognition.

All three are called through the same OpenAI-compatible Chat Completions shape; only the base URL, model, and whether `image_url.detail` is honored differ. Image detail defaults to `high` for better recognition. The model is overridable per user (versions rotate).

**Free-tier limits & fallback.** Provider free tiers are rate-limited — e.g. Gemini's free tier allows roughly 20 requests/day on `gemini-3.6-flash` plus a per-minute cap, and returns a "quota exceeded" (429) error once hit; models can also be temporarily "overloaded" (503), or a key can hit a **billing/credit** problem (402, e.g. "prepayment credits are needed"). Settings surfaces this, and you can configure a **fallback provider** (OpenAI/`gpt-4o-mini` recommended — most accurate for food): if the primary hits a rate-limit, overload, or billing error while logging a photo, the Worker automatically fails over to the fallback (after retrying a transient 503 on the primary once). The fallback lives behind a toggle in Settings — turning it **off keeps the stored key** (only "Remove" deletes it). Each logged meal records which provider actually analyzed it (shown on the meal card and detail), and the bot's photo reply summarizes the interpreted foods plus estimated calories/protein/carbs/fat. The fallback key is encrypted at rest like the primary and stored in `preferences_json`.

## Status

The full core build (Tasks 1–12) is done and deployed, plus full CRUD, editable macros, bot-photo auto-log, and photos-in-logs. Multi-provider AI (Gemini / OpenAI / DeepSeek) with in-app provider + model selection is live. Privacy & data control shipped: **export** your data (`GET /api/account/export` → downloadable JSON; the encrypted API key is never included) and **delete** your account (`DELETE /api/account`, cascading to all meals/photos/settings), both surfaced in Settings alongside a plain-language privacy explanation.

The Mini App (shadcn/ui + Tailwind v4, Telegram theming, native buttons + haptics) is a focused two-tab app: **Home** and **Settings**. Home is a day view — a clickable calendar to pick any day, that day's totals, and its meals; each meal supports **swipe-left-to-delete** and **"Update with AI"**. Update-with-AI is a review-before-save flow: describe a change in plain words ("add a can of coke", "the rice was double"), the AI drafts the revised meal (`POST /api/meals/:id/revise`, no persistence), you review it — AI-removed foods show as "will be removed" with Undo — and save when it looks right. The History, Search, and Stats tabs (and their endpoints) were removed. Screens are code-split (`React.lazy`) and Home fetches only the selected day (`GET /api/meals?date=` + `GET /api/meals/dates`) for a fast first load.

**Goals & daily targets.** A skippable onboarding collects your profile (sex, age, height, weight, activity, goal) and computes daily calorie + macro targets using the **Mifflin-St Jeor** BMR equation × activity factor, adjusted by goal (lose −20% / maintain / gain +10%); protein at 1.8 g/kg, fat at 25% of calories, carbs from the remainder. Metric (kg/cm) or imperial (lb/ft-in) units, and a **simple/advanced** toggle for manual calorie/macro overrides. Home then shows **progress rings** for calories, protein, carbs, and fat remaining for the selected day. Profile lives in `preferences_json` (no schema migration) and is editable in Settings. See `PLAN.md` §10–§12 for the full progress log and roadmap.
