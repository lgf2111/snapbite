# SnapBite — Project Context & Handoff

> A single-file brain dump so a fresh session (or a new collaborator) can understand the whole
> project and continue without re-discovering everything. Written 2026-09, updated 2026-10. Pair this
> with `README.md` (user-facing + architecture), `FEATURES.md` (feature list), `ROADMAP.md` (the
> forward-looking roadmap defined by the Visionary session), and `.kiro/steering/lightweight.md`
> (the guiding principle — read it, it governs every decision).
>
> NOTE: the old `IMPROVEMENTS.md` (backlog #1–#15) and `PLAN.md` (original build log) were **removed**
> once their work was fully shipped — this file + `ROADMAP.md` carry everything a new session needs.

---

## 1. What SnapBite is

A **Telegram-native, low-friction, AI-assisted food & nutrition logger**. The core loop:

> unlock phone → send a meal photo to the bot (`@SnapBiteAI_bot`) → a vision model identifies
> foods, portions, and rough nutrition → the bot logs it and replies → open the Mini App to
> review/correct → done.

Key properties:
- **BYOK (bring your own key).** Nutrition/AI runs on the *user's own* provider API key
  (Gemini / OpenAI / DeepSeek), stored AES-256-GCM encrypted in D1. We take on **zero** per-request
  model cost. This is a hard product rule.
- **Everything is an editable estimate.** Nutrition values are always shown as estimates and remain
  user-correctable.
- **Lightweight above all.** Small bundles, minimal deps, cheap runtime, stay within Cloudflare's
  free tier. See `.kiro/steering/lightweight.md`. When a feature adds weight, flag it and prefer the
  lightest alternative (e.g. the vision model reads barcode *digits* rather than bundling a WASM
  barcode reader; a cheap conditional `fetch` to Open Food Facts beats bundled compute).

### History / rebrand (important)
The project was formerly **FoodLog** and was fully rebranded to **SnapBite**: new bot
(`@SnapBiteAI_bot`), renamed infra (`snapbite-worker`, `snapbite` Pages, `snapbite-db`, `@snapbite/*`
packages). The old FoodLog worker + D1 + bot are **fully retired/deleted**. One lasting consequence:
**photos logged through the old FoodLog bot don't display** — their Telegram `file_id` is tied to the
retired bot's token, so the new bot can't `getFile` them. The meal data is intact; only the image
preview is missing. (Documented in FEATURES.md "Notes & known limitations".)

---

## 2. Repository & tooling

- **Path:** `/Users/leeguanfeng/Documents/Github/snapbite`
- **Git remote:** `https://github.com/lgf2111/snapbite.git`, branch `main`.
- **Monorepo:** pnpm workspaces. `packageManager: pnpm@12.4.2`, Node ≥ 20.
- **Formatter/linter:** Biome (`biome.json`). `pnpm lint` = `biome check .` — includes **formatting**;
  exits 0 on warnings, non-zero on errors. There are **7 known style warnings**
  (`noNonNullAssertion` ×5, `noExplicitAny` ×2) set to `"warn"` on purpose — not errors.
- **CI:** `.github/workflows/ci.yml` runs on push/PR to `main`: pnpm install → build `@snapbite/core`
  → `pnpm lint` → `pnpm typecheck` → `pnpm test`.

### Packages
```
packages/core      @snapbite/core   — transport-agnostic domain logic (zero platform imports)
apps/worker        @snapbite/worker — Cloudflare Worker (Hono) + D1 (Drizzle); API + bot webhook + cron
apps/miniapp       @snapbite/miniapp— React + Vite Telegram Mini App (shadcn/ui + Tailwind v4), on Pages
apps/cli           @snapbite/cli    — local harness to run a photo through the pipeline end-to-end
```

### Commands that matter (memorize these)
```bash
# Build core FIRST — apps typecheck/test against its built dist:
pnpm -C packages/core build            # tsc -b

# Per-package tests (vitest):
pnpm -C packages/core exec vitest --run
pnpm -C apps/worker  exec vitest --run     # Miniflare D1; prints a long "xxxx" line (a capping test) — expected
pnpm -C apps/miniapp exec vitest --run     # jsdom
pnpm -C apps/cli     exec vitest --run

# Typecheck (apps use a dedicated tsconfig):
pnpm -C apps/worker  exec tsc -p tsconfig.typecheck.json
pnpm -C apps/miniapp exec tsc -p tsconfig.typecheck.json
pnpm -C apps/cli     exec tsc --noEmit

# Lint / format:
pnpm lint
pnpm exec biome check --write <files>      # auto-format (do this before committing; edits often need it)

# Deploy:
cd apps/worker  && yes | npx wrangler deploy          # use `npx wrangler`, not pnpm exec (noisy reinstall)
cd apps/miniapp && yes | pnpm run deploy              # builds with prod VITE_WORKER_URL + guards mock mode

# Register bot command menu (needs the REAL bot token):
TELEGRAM_BOT_TOKEN=<token> pnpm --filter @snapbite/worker bot:commands
```

**Current green baseline:** core **148**, worker **133**, miniapp **40**, cli **8** tests (329 total);
all typechecks pass; lint clean (7 warnings).

**Shell quirk:** commands sometimes return empty output / exit -1 — just retry, it's a tooling glitch,
not a real failure.

---

## 3. Architecture & data flow

### Worker (`apps/worker`)
- Hono app (`src/app.ts`) + default export in `src/index.ts` (`fetch` + `scheduled` cron).
- **D1** `snapbite-db` (id `6c331800-c9a5-4c32-b5b4-17190c23dd6c`), Drizzle ORM. Schema in
  `src/db/schema.ts`. Tables: `users`, `settings`, `meals`, `food_items`, `nutrition`, `saved_meals`
  (favorites), `error_logs`, `feedback`, plus a photo-retry queue table.
- Auth: Telegram `initData` HMAC verification (middleware `src/middleware/auth.ts`), using core's
  `verifyInitData`. Mini App sends `initData` on every request; `c.get('userId')` is the app user.
- Routes (`src/routes/*`): `meals.ts` (analyze/save/CRUD/list/dates/detail/revise/photo),
  `settings.ts`, `account.ts` (export/delete), `favorites.ts`, `feedback.ts`, `webhook.ts` (the bot).
- `webhook.ts` is the big one: parses updates (via core `parseUpdate`), dispatches commands
  (`/start /help /settings /setup /cancel /feedback /saved /ping /errors /broadcast`), handles photo
  logging (`handlePhoto`), and the plain-text "revise last meal" flow.
- **BYOK crypto:** key stored as `apiKeyCiphertext` + `apiKeyIv` in `settings`; `decryptSecret`
  (core AES-GCM) decrypts in-memory per request. Never returned or logged.
- **Cron** (`wrangler.toml` `*/15 * * * *`): `scheduled()` runs `runReminders`, `runPhotoRetries`,
  and `pruneErrorsOlderThan(DB, now - 30d)` — all via `ctx.waitUntil`, all best-effort.

### Core (`packages/core`)
- `schemas/` — Zod: `AIFoodAnalysis`, `MealResult`, `Food`, `Nutrition`, etc.
- `ai/` — `AIProvider` interface + `openai-compatible.ts` (generic adapter; **coercion layer** that
  repairs model output before schema validation: `coerceAnalysis`/`stripCodeFences`/`num`/
  `coerceConfidence`/`coerceNutrition`; and a **one-shot repair retry** on a parse/empty failure via
  `#complete`/`#post`). Provider presets Gemini/OpenAI/DeepSeek (`registry.ts`), `mock.ts`
  (`MockAIProvider` + `DEFAULT_MOCK_ANALYSIS` — public, used by the CLI test), `prompt.ts`.
- `nutrition/` — deterministic `resolver.ts` + bundled per-100g `table.ts`; tags each value's source
  (`table`/`ai_estimate`/`manual`/`mixed`). `format.ts` for display.
- `telegram/` — `initData.ts` (HMAC verify), `bot.ts` (`parseUpdate`, `replyForCommand`,
  `photoLoggedReply`, `/help` text).
- `profile/` — Mifflin–St Jeor BMR → TDEE → calorie/macro targets (`computeTargets`). Stores
  `birthDate` (age auto-updates).
- `reminders/` — due-slot logic; **public barrel narrowed** (index.ts re-exports only
  `DEFAULT_REMINDER_TIMES`, `REMINDER_STEP_MINUTES`, `dueReminderSlots`, `reminderMessage`,
  `snapToReminderStep`, `DueCheckConfig`; internals `parseHhMm`/`localParts`/`REMINDER_MESSAGES`
  stay in `reminders.ts` for tests only).
- `onboarding/` — conversational `/setup` state machine. `crypto/` — AES-GCM. `version/` — changelog.

### Mini App (`apps/miniapp`)
- React 19 + Vite, `@telegram-apps/sdk-react`, shadcn/ui + Tailwind v4. Hosted on **Cloudflare Pages**
  project `snapbite` (`snapbite-8f7.pages.dev`, custom domain **`snapbite.leeguanfeng.com`**).
- Two tabs: **Home** (day view: calendar date picker, that day's rings + meals, swipe-to-delete,
  Update-with-AI) and **Settings**. History/Search/Stats tabs were removed.
- `lib/backend.ts` — the data layer `Backend` interface; **worker mode** (real API via
  `lib/api.ts` `ApiClient`) or **local mode** (localStorage via `lib/store.ts`, for browser dev when
  no `VITE_WORKER_URL`).
- `lib/cache.ts` + `lib/useCachedData.ts` — hand-rolled stale-while-revalidate cache (NO react-query;
  that's explicitly rejected as too heavy). Cache keys in `cacheKey`.
- `lib/weekPrefs.ts` — week definition (rolling/calendar) + **weekly view mode** (Total / Daily avg)
  + the canonical local day-key formatters (`dayKey`/`dayKeyFromMs`/`todayKey`).
- Code-split: Settings/MealDetail/Onboarding are `React.lazy`; HomeScreen is static (first screen);
  the calendar (`react-day-picker`, ~73 kB) lazy-loads only when the popover opens.
- Landing page: `index.html` has a plain-CSS marketing page shown in a browser; `main.tsx` removes it
  and mounts the React app only inside Telegram.

---

## 4. Secrets & config

- Secrets are **never committed**; local files are gitignored.
- Root `.env` — has `DEEPSEEK_API_KEY` and now `TELEGRAM_BOT_TOKEN` (added by the owner) for CLI /
  local scripts.
- `apps/worker/.dev.vars` — local Worker secrets (`TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY`,
  `MINI_APP_URL`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, optional `ADMIN_GROUP_CHAT_ID` +
  `*_THREAD_ID`). ⚠️ The token in `.dev.vars` was a **26-char placeholder** (real tokens are ~46
  chars) — `bot:commands` 401'd on it. The real production token lives only in Worker secrets
  (`wrangler secret put`). If you need to register commands, use the real token from `.env` or the
  owner.
- `apps/miniapp` build — `VITE_WORKER_URL` points at the deployed Worker (empty = mock mode). The
  `deploy` script bakes in `https://snapbite-worker.lgf2111.workers.dev` and aborts if the bundle
  would ship in mock mode.
- Production worker URL: `https://snapbite-worker.lgf2111.workers.dev`; health check `GET /api/health`
  → 200 (no `/health` or `/` route — those 404 by design; `/webhook` is POST-only with a secret
  header).

**Admin alerts:** when `ADMIN_GROUP_CHAT_ID` is set, error/feedback/broadcast alerts post into that
group's forum **Topics** (`ERRORS_THREAD_ID`/`FEEDBACK_THREAD_ID`/`BROADCAST_THREAD_ID`); otherwise
they DM `ADMIN_TELEGRAM_ID`. `adminNotify` falls back to DM + logs on group-post failure. Admin-only
`/ping` sends a sample alert through this path to verify delivery end-to-end.

---

## 5. Current state (as of this handoff)

**All 15 top backlog items (#1–#15, formerly tracked in `IMPROVEMENTS.md`, now removed) are
implemented, verified, committed, pushed, and deployed** (worker version `b7f0da58`; Pages live).
Each has a commit ref in git history (`git log --oneline`). Highlights shipped this cycle:
- CI workflow; AI one-shot repair-retry + Zod-issue detail in `error_logs`; admin `/ping`;
  HomeScreen + useCachedData component tests; `/saved` bot command (list + re-log favorites);
  weekly Total/Daily-avg toggle; clearer onboarding-skip path; **per-user photo rate limit** (40
  photos/rolling hour, one indexed COUNT); server-side `?from=&to=` meals range; narrowed core
  barrel; `foodlog.*`→`snapbite.*` localStorage migration; a11y pass (aria labels, Biome a11y clean);
  `error_logs` 30-day retention sweep in cron.

An **"Explicitly out of scope"** list is deliberately NOT done and should stay that way
(client-side barcode/image lib, state-mgmt lib, react-query/SWR package, server-side AI, heavier UI
kit) — they'd all violate the lightweight principle. It's carried forward in `ROADMAP.md`.

**Outstanding small thing:** the bot command menu wasn't re-registered to include `/saved` in the
`/` autocomplete (the local token was a placeholder). `/saved` itself works; it's just not listed.
Run `bot:commands` with the real token to finish that.

---

## 6. Known limitation to think about later — GROUP CHAT PHOTOS

The owner asked: "if I add the bot to a group chat, when I open the Mini App can it render a photo
uploaded in the group?" **Not as built today.** Two issues:
1. **Ownership:** `handlePhoto` keys the meal to `message.from.id` (the sender) and the Mini App is
   strictly owner-scoped. A group photo would log to the poster's own account (and only if *they*
   have an AI key). There is no shared/group log concept.
2. **Receiving + re-fetching group photos:** a bot in a group has **privacy mode ON by default**, so
   it does NOT receive plain photo messages (only commands/replies/mentions) — no update, nothing
   logged. To receive group photos you'd disable privacy mode in BotFather. Photos the bot genuinely
   received remain `getFile`-able while it's a member.

To make the simple case work: bot in group + privacy off + log each poster's photo to their own
account. A *shared* group log is a larger change (needs group-scoped meal ownership — doesn't exist).
The whole photo flow currently assumes a 1:1 chat (edits an "Analyzing…" message in place, per-user
rate limit, reply-to-revise). Treat group support as a design task, not a quick patch.

---

## 7. Working norms (how the owner likes changes made)

- Implement in **verified batches**, each its own commit: write code → build core → typecheck →
  run affected suites → `pnpm lint` (auto-format with `biome check --write` when it complains) →
  update README/FEATURES → commit. Keep commits scoped; stage specific files.
- **Update docs** (README/FEATURES) alongside behavior changes.
- Add tests for new features/bugfixes; match existing test style (vitest; worker tests seed via
  authed API requests + `cloudflare:test` `env`; miniapp uses `@testing-library/react`, telegram lib
  is a jsdom no-op so no mock needed; `localStorage.clear()` in `afterEach` to avoid cross-test leak).
- Never commit secrets. Flag high-impact/prod actions (deploys, destructive ops) before running.
- Honor the lightweight steering rule above all; flag any added weight.
- `tsconfig.typecheck.json` is strict — e.g. `mock.calls[0][0]` is possibly-undefined; prefer
  `toHaveBeenCalledWith(expect.objectContaining(...))`.

---

## 8. "Visionary" session — likely intent

The **"Visionary"** session owns forward-looking product/architecture work and has defined the
roadmap in **`ROADMAP.md`** (repo root) — read that for the *next* set of directions. The old
incremental backlog is fully shipped. Still-relevant parked thread:
- **Group-chat photo support** (section 6) — the owner explicitly parked this "for the future";
  it's roadmap item **R8** in `ROADMAP.md`.

Weigh every idea against the lightweight principle and BYOK / no-server-side-AI-cost rules.

Start by reading: this file → `.kiro/steering/lightweight.md` → `ROADMAP.md` → `README.md` →
`FEATURES.md`. Then `git log --oneline -20` for the latest work. Build core before
typechecking/testing anything.
