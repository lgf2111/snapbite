# FoodLog — Session Handoff

> This document is the single source of truth for continuing work on FoodLog with
> zero prior context. It captures the goal, current state, decisions, files, open
> problems, next steps, and exact commands. Read it top to bottom before making changes.

---

## 1. Goal

**FoodLog** is a Telegram-native, AI-assisted food/nutrition logging app. A user sends a
**photo of a meal to the Telegram bot** → the Worker runs it through the user's chosen AI
provider (BYOK — bring your own key) → the meal is analyzed into foods + per-food nutrition,
resolved against a bundled table, and logged. A **Telegram Mini App** (React) lets the user
review/edit meals, see a day view with **daily calorie/macro target rings**, set their
**goal/profile**, and manage settings. Everything runs on Cloudflare free tiers; the user's
AI cost is on their own key.

Immediate active focus: a batch of UX/robustness fixes (see §5 Open problems and §6 Next steps).

---

## 2. Current state (what's done & working)

**Deployed and working end-to-end in production.** Send a photo to the bot → it's analyzed
and logged with the photo; the Mini App shows it.

Delivered features (all live):
- **Monorepo** (pnpm workspaces): `packages/core` (transport-agnostic logic), `apps/worker`
  (Cloudflare Worker + D1 + Hono), `apps/miniapp` (React 19 + Vite 6 + shadcn/ui + Tailwind v4),
  `apps/cli` (local harness).
- **AI pipeline**: provider-agnostic `AIProvider` over any OpenAI-compatible Chat Completions
  endpoint. Presets: **Gemini** (default, `gemini-3.6-flash`), **OpenAI** (`gpt-4o-mini`),
  **DeepSeek** (`deepseek-flash`). Photo → `analyzeMeal` → `AIFoodAnalysis` → `resolveMeal`
  (table-first nutrition, AI fallback, source-tagged) → `MealResult`.
- **Worker + D1**: Telegram `initData` HMAC auth; encrypted BYOK key (AES-256-GCM); meal CRUD;
  bot webhook (photo auto-log + `/start /help /settings`); photo proxy (`GET /api/meal-photo/:id`).
- **Mini App = two tabs: Home + Settings.** Home is a **day view**: a clickable calendar
  (`DateSelector`, react-day-picker), that day's **4 progress rings** (kcal/protein/carbs/fat
  remaining vs. target), and the day's meals with **swipe-left-to-delete** and an **✨ Update
  with AI** icon. History/Search/Stats tabs were removed.
- **Goals & onboarding**: skippable onboarding collects a profile (sex, age, height, weight,
  activity, goal); daily targets via **Mifflin-St Jeor BMR × activity, adjusted by goal**
  (lose −20% / maintain / gain +10%; protein 1.8 g/kg, fat 25%, carbs remainder; ≥1200 kcal).
  Editable in Settings. Metric/imperial units + simple/advanced (manual override) mode.
- **Update-with-AI = review-before-save draft**: `POST /api/meals/:id/revise` returns a revised
  `MealResult` **without persisting**; the detail screen applies it as a draft (marks dirty),
  AI-removed foods show struck-through "will be removed" with Undo, **X = discard** (confirm if
  dirty), and **Save** persists via `PUT /api/meals/:id`.
- **Privacy/data control**: `GET /api/account/export` (full JSON, never the key), `DELETE /api/account`
  (cascade delete). Export handles Telegram webview quirks (native download → openLink → blob).
- **Fallback AI provider**: `PUT /api/settings/fallback` stores an optional second provider + key
  (encrypted, in `preferences_json`). On a photo-log quota/overload error, the webhook is *meant*
  to fail over to it (see §5 — currently under-triggering).
- **Error handling**: friendlier bot messages for 429/503; a transient 503 on the primary is
  retried once; AI calls are time-bounded (client 60s, worker 45s) to avoid Cloudflare 524s.

**Test counts (all green):** core **92**, cli **8**, miniapp **16**, worker **62**.

**Latest deploys:** Worker version `619e1c7a`, Pages `6a24d0be`. D1 migrations applied through
`0003_omniscient_shinko_yamashiro.sql` (adds `meals.ai_provider`) local + remote. Last commit on
`main` before this batch: `c165917`; this batch is committed on top (see git log). `HEAD == origin/main`.

---

## 3. Key decisions (do not relitigate)

- **BYOK, server-side proxy.** API keys are stored **AES-256-GCM encrypted** in D1; all AI calls
  go through the Worker. Plaintext keys are never returned, logged, or exported.
- **Bot-only photo logging.** The Mini App does **not** capture photos (can't retain the image for
  free). Logging happens by sending a photo to the bot chat; only the Telegram `file_id` is stored.
- **Nutrition is table-first**, AI estimate as fallback, always source-labeled and user-correctable.
  Never ask the AI for calories directly — ask for foods + per-100g `aiNutrition`, resolve deterministically.
- **`packages/core` is transport-agnostic** — no Telegram/Worker/D1 imports. Keep it that way.
- **Profile + fallback live in `settings.preferences_json`** (JSON blob) to avoid DB migrations.
  Shape: `{ profile: UserProfile, fallback?: { provider, model, keyCiphertext, keyIv }, updatedAt }`.
  The fallback key is encrypted the same way as the primary and is **excluded from export**.
- **Calorie math**: Mifflin-St Jeor. Protein **1.8 g/kg current bodyweight**. Units default metric,
  user-switchable; canonical storage is always **kg/cm** (display converts).
- **Update-with-AI must be review-before-save** (never auto-persist). AI-removed foods are soft-deleted
  (reviewable) not dropped. X discards.
- **Fallback provider recommendation is OpenAI** (`gpt-4o-mini`) — most accurate for food; DeepSeek is
  cheapest. Verified OpenAI works via the existing OpenAI-compatible path (`https://api.openai.com/v1`
  + `/chat/completions`, base64 `image_url`, `detail: high`, JSON output) — no core change needed.
- **Mini App is shadcn/ui + Tailwind v4.** Reusable UI primitives live in `apps/miniapp/src/components/ui/`.
- **Removed** History/Search/Stats tabs and their endpoints (`GET /api/search`, `GET /api/analytics`)
  deliberately; do not re-add without a reason.

---

## 4. Files touched (map)

### packages/core (`@foodlog/core`, transport-agnostic; build with `pnpm build`)
- `src/ai/types.ts` — `AIProvider` interface (`analyzeMeal`, `reviseMeal`), `MealImage`, `AIProviderError` (has `kind`, `status`).
- `src/ai/openai-compatible.ts` — `OpenAICompatibleProvider` (shared `#complete()` for analyze + revise; JSON mode; `image_url.detail` when `supportsDetail`).
- `src/ai/registry.ts` — `PROVIDER_PRESETS` (gemini/openai/deepseek), `createProvider()`, `DEFAULT_PROVIDER_ID='gemini'`, `isProviderId()`.
- `src/ai/prompt.ts` — `SYSTEM_PROMPT` (analyze), `REVISE_SYSTEM_PROMPT` + `buildRevisePrompt()` (text-only revise).
- `src/ai/mock.ts` — `MockAIProvider` (deterministic; used by CLI/tests/local mode).
- `src/nutrition/resolver.ts` — `resolveFoodNutrition`, `aggregate`, `resolveMeal` (AIFoodAnalysis → MealResult).
- `src/schemas/*` — Zod schemas: `food.ts` (`FoodItem`, `NutritionPer100g`, `manualNutrition`), `analysis.ts` (`AIFoodAnalysis`), `meal.ts` (`MealResult`).
- `src/profile/profile.ts` — `UserProfile` Zod schema, `DailyTargets`, `computeBmr/computeTdee/computeTargets`, unit helpers (`kgToLb`, `lbToKg`, `feetInchesToCm`, `inchesToFeetInches`, `cmToInches`). `src/profile/profile.test.ts` (14 tests).
- `src/telegram/bot.ts` — `parseUpdate`, `replyForCommand`, `mealLoggedMessage`, **`photoLoggedReply(foods, energyKcal, config)`** (the brief bot reply after a photo log — see §5/§6, needs to become detailed).
- `src/crypto/aesgcm.ts` — `encryptSecret`/`decryptSecret`/`lastFour`.
- `src/index.ts` — barrel; re-exports every module.

### apps/worker (Cloudflare Worker + D1 + Hono)
- `src/app.ts` — mounts routes under `/api` (auth middleware) + `/webhook` + `/api/meal-photo`.
- `src/routes/webhook.ts` — **bot webhook.** `handlePhoto()` runs analyze (retry once on 503) → `resolveMeal` → `saveMeal` → `photoLoggedReply`. Contains `isFailoverError()`, `tryFallback()`, `friendlyPhotoError()`, `providerMessage()`. **← the fallback bug lives here (§5).**
- `src/routes/meals.ts` — `mealsRoutes` (analyze/save/list/detail/update/delete + `POST /:id/revise` DRAFT + `GET /?date=` + `GET /dates`), `mealPhotoRoutes`, `detailToAnalysis()`, `groupByDay()`, `ProviderFactory`.
- `src/routes/settings.ts` — `GET /api/settings` (returns provider/model/connected/keyLast4 + `profile`+`targets` + fallback status), `PUT /api/settings` (key), `PUT /api/settings/profile`, **`PUT /api/settings/fallback`** (empty key clears it), `POST /api/settings/test`. Helpers: `profileFrom`, `mergePreferences`.
- `src/db/settings.ts` — `getSettings`, `saveEncryptedKey`, `savePreferences`, `parsePreferences`, types `Preferences`/`FallbackConfig`.
- `src/db/meals.ts` — `saveMeal`, `listMeals` (MealSummary now has `proteinG/carbsG/fatG`), `getMealDetail`, `updateMeal`, `deleteMeal`.
- `src/db/account.ts` — `exportUser` (excludes key), `deleteAccount`.
- `src/db/schema.ts` — Drizzle schema. `settings` has `apiKeyCiphertext/apiKeyIv/aiProvider/aiModel/preferencesJson`. `food_items` has per-food kcal/P/C/F. **No new migration needed for current work.**
- `src/middleware/auth.ts` — Telegram initData HMAC (header `x-telegram-init-data`, or `?initData=` query for the photo proxy).
- `migrations/` — 0000/0001/0002 already applied local + remote.

### apps/miniapp (React Mini App)
- `src/App.tsx` — 2-tab shell (Home/Settings), lazy-loads Settings/MealDetail/Onboarding; fetches `getSettings` for targets + `hasProfile`; skippable onboarding gate; `openMeal` vs `openMealWithAi`.
- `src/lib/api.ts` — `ApiClient`: `analyze/saveMeal/updateMeal/deleteMeal/listMeals(date?)/mealDates/getMeal/reviseMeal(draft)/getSettings/saveApiKey/saveProfile/saveFallback/exportData/exportUrl/photoUrl`. `#request` has per-call timeouts (AI 60s). `SettingsView` includes profile/targets/fallback fields. `MealSummary` has P/C/F.
- `src/lib/backend.ts` — `Backend` interface + worker/local impls: `update/reviseDraft/remove/recent/mealsByDate/mealDates/detail/getSettings/saveApiKey/saveProfile/saveFallback/exportData/exportUrl/deleteAccount/photoUrl`. `RecentMeal` has P/C/F. Local mode uses localStorage + `computeTargets`.
- `src/lib/store.ts` — localStorage helpers incl. `loadProfile/saveProfileLocal/clearProfile`.
- `src/lib/telegram.ts` — SDK integration: theme, native Back/Main buttons, haptics, `downloadViaTelegram`/`openExportUrl`.
- `src/components/HomeScreen.tsx` — day view: `DateSelector` + 4 `ProgressRing`s (or soft "set goal" card) + meal list (SwipeableRow + ✨ icon → `onOpenMealWithAi`).
- `src/components/MealDetailScreen.tsx` — edit meal; **review-before-save AI draft** (`applyAiDraft`, `pendingRemove` soft-delete + Undo, dirty-gated Save, X=discard-with-confirm), lazy.
- `src/components/UpdateWithAi.tsx` — exports **`ReviseWithAiDialog`** (calls `backend.reviseDraft`, spinner + cycling status, `onDraft(revised)`).
- `src/components/SettingsScreen.tsx` — profile card (uses `ProfileForm`), primary AI provider card (provider select/model/key + free-tier note), **fallback card** (Switch-gated, Collapsible, defaults OpenAI), privacy/export/delete.
- `src/components/ProfileForm.tsx` — shared onboarding/settings form; uses `NumberField` (blank-until-blur) + `Switch` (advanced) + `Collapsible`; live target preview.
- `src/components/OnboardingScreen.tsx` — skippable; wraps `ProfileForm`.
- `src/components/ProgressRing.tsx` — SVG ring; over-target → red + "over".
- `src/components/DateSelector.tsx` — date pill + prev/next + calendar popover (lazy Calendar).
- `src/components/SwipeableRow.tsx` — swipe-left-to-delete (react-swipeable); rounded outlined delete pill, icon centered in the visible strip.
- `src/components/MacroLine.tsx` — renders 🔥 kcal · 🥩 protein · 🍚 carbs · 🧈 fat (emoji legend lives implicitly here; see §6 item 3).
- `src/components/NumberField.tsx` — numeric input that stays blank while editing, clamps on blur.
- `src/components/ui/` — shadcn primitives: button, card, dialog, input, label, tabs, skeleton, badge, sonner, popover, calendar, **switch**, **collapsible**.
- `src/lib/api.test.ts`, `src/lib/backend.test.ts`, `src/lib/store.test.ts` — tests.

### apps/cli
- `src/index.ts`, `src/args.ts` (+ `args.test.ts`) — local harness (`--real` uses a real provider, default mock).

---

## 5. Open problems / blockers (the current work queue)

> **UPDATE (this batch — all six DELIVERED & deployed).** Worker `619e1c7a` (fallback
> failover for 402/billing + toggle-keeps-key + detailed bot reply + per-meal provider,
> migration `0003` applied local+remote), Pages `6a24d0be`. Tests green: core 92, cli 8,
> miniapp 16, worker 62. What shipped:
> 1. **Fallback failover fixed** — `isFailoverError` now covers 402 + credit/billing/
>    insufficient/balance/payment/prepay/exceeded (and non-400/401 4xx), so "prepayment
>    credits are needed" now fails over. `friendlyPhotoError` has a billing branch.
> 2. **Toggle-off keeps the key** — `FallbackConfig.enabled` flag; `PUT /api/settings/fallback`
>    supports `{apiKey}` (store), `{enabled}` (toggle, keeps key), `{remove:true}` (wipe).
>    `tryFallback` skips a disabled fallback. Settings toggle disables (not clears); a separate
>    Remove button deletes.
> 3. **Provider placeholder/hint** already tracked the selected provider; fallback now defaults
>    to OpenAI; placeholders read `default: <model>`. The stale text was a pre-deploy artifact.
> 4. **Detailed bot reply** — `photoLoggedReply(foods, totals, config)` lists foods + total
>    kcal/protein/carbs/fat as estimates.
> 5. **Per-meal provider label** — `meals.ai_provider` column (migration 0003); persisted on
>    save (primary or the fallback actually used); shown on Home cards ("Gemini") + detail
>    ("analyzed by …").
> 6. **Emoji legend** — `MacroLegend` (🔥 calories · 🥩 protein · 🍚 carbs · 🧈 fat) on the Home
>    meal list and the meal-detail Total.
>
> The items below are the ORIGINAL descriptions, kept for reference. Nothing here is open.

1. **[BUG — highest priority] Fallback isn't triggering for "prepayment/credit" errors.**
   The user has a fallback configured but still gets an error like *"prepayment credits are needed"*
   (an OpenAI/DeepSeek **billing/credit** error, typically HTTP **402** or a message containing
   "credit"/"billing"/"insufficient balance/quota"). In `apps/worker/src/routes/webhook.ts`,
   `isFailoverError()` only matches **429/503** or the regex
   `/quota|rate limit|resource_exhausted|overloaded|high demand|unavailable/i`. A billing/credit
   error matches none of these, so `tryFallback` rethrows instead of failing over.
   **Fix:** broaden `isFailoverError` to also treat **402** and messages matching
   `/credit|billing|insufficient|balance|payment|prepay/i` (and probably any 4xx that isn't 400/401)
   as failover-worthy. Also confirm the error `status`/`cause` actually propagate from
   `OpenAICompatibleProvider` (it throws `AIProviderError('http', ..., { status, cause: bodyText })`).
   Add a worker test for a 402/"credit" primary error → fallback used.

2. **Fallback toggle OFF currently deletes the saved fallback key.** In
   `SettingsScreen.tsx`, `handleToggleFallback(false)` calls `handleClearFallback()` which sends an
   empty key to `PUT /api/settings/fallback` (clears it). The user wants toggling off to **keep** the
   stored key (just disable/collapse). **Fix:** add an explicit "enabled" flag to the stored
   fallback (e.g. `fallback.enabled: boolean` in `preferences_json`) OR a separate `fallbackEnabled`
   pref; toggle off should set enabled=false without wiping `keyCiphertext/keyIv`. `tryFallback`
   must check `enabled !== false`. Update GET to report `fallbackEnabled`.

3. **Primary provider UI still suggests DeepSeek, not OpenAI.** In `SettingsScreen.tsx` the primary
   card's model **placeholder**, and the **keyHint** below the key input, come from
   `PROVIDER_PRESETS[provider]` where `provider` state defaults to `'gemini'` — but the user is seeing
   DeepSeek text. Verify what `provider` initializes to and that the placeholder/hint track the
   selected provider; the user wants OpenAI reflected. (Also double-check the fallback card already
   defaults `fbProvider='openai'` — it does, but confirm the visible placeholder/hint match.)
   NOTE: re-read the exact current code before editing; the primary card default may need to follow
   the loaded `settings.aiProvider`.

4. **Meal cards should show which AI provider analyzed them.** Currently not stored per-meal.
   Requires persisting the provider id on the meal (e.g. a column or reuse `nutrition.source` is NOT
   right — that's table/ai_estimate). Likely add `ai_provider` to the `meals` table (**new migration**)
   or store it in the meal notes/food source. Surface it on each meal card (Home rows + detail).
   Decide storage approach; a migration is acceptable here.

5. **Bot photo reply should be detailed, not brief.** `photoLoggedReply()` in
   `packages/core/src/telegram/bot.ts` currently sends a one-liner. The user wants it to summarize
   what was interpreted: the foods, and total **calories, protein, carbs, fat**. Update
   `photoLoggedReply` (and its call site in `webhook.ts` which passes `foods` + `energyKcal` — it
   will need the full `MealResult.total` now). Update `bot.test.ts`.

6. **Emoji legend / tooltips.** The macro emojis (🔥 kcal, 🥩 protein, 🍚 carbs, 🧈 fat) are unexplained.
   Add either tooltips or a small legend (e.g. on Home and/or in `MacroLine`). shadcn has no tooltip
   primitive installed yet — either add one or use a simple legend row.

**Environment note:** the user is testing inside real Telegram (iOS + macOS desktop). AI calls use
the user's own keys. The primary is Gemini (free tier — ~20 req/day cap, hence the fallback work).

---

## 6. Next steps (priority order)

> **All items in the current batch (§5.1–§5.6) are done, tested, and deployed.** No open
> work items remain from this batch. The original priority list is preserved below for
> reference. Future ideas if the user wants more: verify the 402→fallback path end-to-end in
> real Telegram; consider fallback-for-revise (Update-with-AI still uses primary only);
> add a settings "test fallback key" button.

1. **Fix fallback failover for billing/credit + 402 errors** (§5.1). Broaden `isFailoverError`,
   verify status/cause propagation, add a worker test, deploy the worker, confirm with the user.
2. **Stop toggling-off from deleting the fallback key** (§5.2). Add `fallback.enabled` (or a separate
   pref), update `PUT /api/settings/fallback` + GET + `tryFallback` + Settings UI.
3. **Fix primary provider placeholder/hint** to reflect the selected/loaded provider (§5.3) — small.
4. **Detailed bot photo reply** (§5.5) — update `photoLoggedReply` + call site + `bot.test.ts`.
   (Core + worker; rebuild core, redeploy worker.)
5. **Per-meal AI provider label** (§5.4) — decide storage (likely new migration adding `meals.ai_provider`),
   thread it through save → summary/detail → meal cards. Apply migration local + remote.
6. **Emoji legend/tooltips** (§5.6) — Mini App only.
7. After each: run the verification commands (§7), deploy, and **commit + push** (the user's standing
   rule: *always update README when committing, and regularly commit/push*). Keep PLAN.md current.

Batching suggestion: items 1–3 are quick worker/Settings fixes → ship together. Items 4 is core+worker.
Item 5 needs a migration. Item 6 is Mini App only.

---

## 7. How to run / test / build

All commands from the repo root unless noted. Package manager is **pnpm** (workspaces).

### Install
```
pnpm install
```

### Build core (required after editing packages/core; workers/miniapp consume built dist)
```
pnpm --filter @foodlog/core build          # or: cd packages/core && pnpm build  (tsc -b)
```

### Typecheck (per package — `pnpm -r typecheck` may time out; run individually)
```
cd packages/core  && pnpm build             # core typechecks as part of build
cd apps/worker    && pnpm typecheck          # tsc -p tsconfig.typecheck.json
cd apps/miniapp   && ./node_modules/.bin/tsc -p tsconfig.typecheck.json
cd apps/cli       && pnpm typecheck
```

### Test
```
cd packages/core && pnpm test                # vitest — 90 tests
cd apps/worker   && pnpm test                # vitest + @cloudflare/vitest-pool-workers (real Miniflare D1) — 57 tests
cd apps/miniapp  && pnpm test                # vitest jsdom — 16 tests
cd apps/cli      && pnpm test                # 8 tests
```
Notes: worker tests need no network (mock provider + Miniflare). Inline `providerFactory` mocks in
worker tests MUST implement BOTH `analyzeMeal` AND `reviseMeal`.

### Miniapp production build (also runs tsc)
```
cd apps/miniapp && export VITE_WORKER_URL=https://foodlog-worker.lgf2111.workers.dev && pnpm build
```

### Deploy
```
# Worker (from apps/worker):
cd apps/worker && pnpm exec wrangler deploy

# Mini App to Cloudflare Pages (from apps/miniapp, after building):
cd apps/miniapp && pnpm exec wrangler pages deploy dist --project-name=foodlog --branch=main --commit-dirty=true
```
Do NOT run long-lived dev servers via automation (they block). If you need one, ask the user to run
`pnpm dev` themselves.

### Live URLs & infra
- Worker: `https://foodlog-worker.lgf2111.workers.dev`
- Mini App (Pages): `https://foodlog-7f5.pages.dev`
- D1 database: `foodlog-db`, id `f0312e67-2fef-47a6-a9ca-59cb9c21a79b` (APAC)
- Bot is configured in BotFather as a **Main Mini App** (launches from the profile "Open App" button)
  + a menu button also points to the Pages URL. Commands/description/about are set in BotFather.

### Debugging the bot
```
cd apps/worker && pnpm exec wrangler tail     # live logs; photo-log errors are console.error'd with kind/status/cause
```

### Secrets (NEVER commit; referenced by key name only)
- Worker secrets (set via `wrangler secret put`): `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY`,
  `TELEGRAM_WEBHOOK_SECRET`, `MINI_APP_URL`. D1 bound as `DB`.
- Gitignored local files: `apps/worker/.dev.vars`, `apps/worker/.bot-token`,
  `apps/worker/.deploy-secrets`, and root `.env` (contains `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`).
  Reference these by name only; do not echo their values.

### Git
- Branch `main`, remote `origin` (GitHub `lgf2111/food-log`). `HEAD == origin/main` at handoff.
- Standing rules from the user: **update README whenever committing**; **commit + push regularly**;
  stage specific files (avoid `git add -A`); never commit secrets.


---

## 13. Future-proofing: model select, 5-stage goal, custom provider (DELIVERED)

> **Status: shipped & deployed.** Worker `b5b2844d`, Pages `73b634e7`. No DB migration.
> Tests green: core 94, cli 8, miniapp 16, worker 68. Delivered in this batch:
> - **Model select + Custom…** — per-provider curated `models[]` dropdown with a free-text
>   escape hatch (primary + fallback), so typos/retired names can't silently break analysis.
> - **5-stage goal slider** — `GOAL_STAGES` (Lose fast/Lose steady/Maintain/Lean gain/Gain fast),
>   factors 0.75/0.88/1.0/1.10/1.20; legacy `lose`/`gain` values map forward via a Zod preprocess.
> - **Custom provider** — any OpenAI-compatible base URL + model + `detail` toggle, for primary
>   and fallback; stored in `preferences_json` (primary) / `FallbackConfig` (fallback).
> - **Bot progress feedback** — `upload_photo` chat action + "Analyzing your meal…" message before analysis.
> - **Local-time day grouping** — `?tz=` offset threaded to the worker; `localDayKey`/`groupByDay`
>   bucket by the user's local day (fixes the 12:30am-filed-yesterday bug).
> - **Swipe-delete icon centered**; **"Gemini"** label (was "Google Gemini").
>
> Original plan retained below for reference.

Three requests, all feasible. Goals:
1. **Model as a select, not free text** — avoid typos / retired-model failures.
2. **Goal = a 5-stage scale** (lose most → gain most) with better-than-"lose/gain" labels.
3. **Custom provider** for power users (arbitrary OpenAI-compatible base URL + model). Confirmed possible — `OpenAICompatibleProvider` already takes any `baseUrl`.

### 13.1 Model select + curated model lists (with custom escape hatch)

Problem: `aiModel` is a free-text `<input>`; a typo or a retired name breaks analysis at runtime.

Design:
- Add `models: string[]` to each `ProviderPreset` in `packages/core/src/ai/registry.ts` — a **curated, current** list per provider (e.g. gemini: `gemini-3.6-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`; openai: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`; deepseek: `deepseek-flash`, `deepseek-chat`). `defaultModel` stays the first/recommended.
- Settings model field becomes a `<select>` populated from `PROVIDER_PRESETS[provider].models`, defaulting to `defaultModel`.
- **Escape hatch (avoids going stale):** include a `Custom…` option that reveals the existing text input, so a user can always type a brand-new model name the day it launches. Store whatever is chosen in `aiModel` (unchanged storage).
- Same treatment for the **fallback** model field.
- Because models rotate, the select is a *convenience + typo guard*, not a hard whitelist — the worker still accepts any string (it already does). No worker validation change needed.

### 13.2 Five-stage goal scale

Current: `Goal = 'lose' | 'maintain' | 'gain'` with `GOAL_FACTORS` 0.8 / 1.0 / 1.1.

New 5 stages (calorie factor vs TDEE), grounded in common cut/bulk ranges (deficit ~15–25%,
surplus ~10–20% — see healthline/bodyspec refs):

| Stage id | Label | Factor | Meaning |
|---|---|---|---|
| `cut` | Lose fast | 0.75 | aggressive deficit (~−25%) |
| `lean` | Lose steady | 0.88 | mild deficit (~−12%) |
| `maintain` | Maintain | 1.00 | recfrom |
| `gain_lean` | Lean gain | 1.10 | small surplus (~+10%) |
| `bulk` | Gain fast | 1.20 | larger surplus (~+20%) |

- Rename the type to a 5-value enum. **Back-compat:** map legacy stored values (`lose`→`lean`, `gain`→`gain_lean`, `maintain`→`maintain`) when parsing an existing profile so no one's saved goal breaks. Keep the 1200 kcal floor.
- Labels: proposed set above ("Lose fast / Lose steady / Maintain / Lean gain / Gain fast"). A cleaner alt: "Aggressive cut / Mild cut / Maintain / Lean bulk / Aggressive bulk". **Decision needed** (see 13.4).
- UI: replace the 3-button `Segmented` with a **5-stop slider/scroller** (a range input or a horizontal segmented scale) from most-loss (left) to most-gain (right), showing the selected label + the resulting calorie delta live. Reuse the target preview.
- Core `GOAL_FACTORS` updates to the 5 keys; `computeTargets` unchanged otherwise. Update `profile.test.ts` known values.

### 13.3 Custom provider (power users)

`OpenAICompatibleProvider` already accepts `{ providerId, apiKey, baseUrl, model, supportsDetail }`,
so a custom endpoint is a thin addition:
- Add a `'custom'` option to the provider picker. When selected, reveal **Base URL** + **Model** text inputs (and a `supportsDetail` toggle, default off for safety).
- Storage: the primary already has `aiProvider`/`aiModel` columns; add the custom **base URL** to `settings.preferencesJson` (e.g. `customProvider: { baseUrl, supportsDetail }`) — **no migration** (or a dedicated column if cleaner; prefer preferences_json to avoid a migration). Fallback custom stored in its `FallbackConfig` (already in preferences_json) — add optional `baseUrl`/`supportsDetail` there.
- Worker: `createProvider` (registry) must accept a custom provider. Extend `CreateProviderOptions`/`createProvider` to take an optional `baseUrl` + `supportsDetail`; when `providerId === 'custom'` (or a baseUrl is supplied), construct `OpenAICompatibleProvider` directly with those. Settings routes read/write the custom fields; webhook `providerFactory` + revise path pass them through.
- Validation: require an https base URL; the "test key" path (`POST /api/settings/test`) already just constructs the provider — good smoke test.
- Keep it clearly labeled "Advanced / for developers".

### 13.4 Decisions (confirmed)

1. **Goal labels:** "Lose fast / Lose steady / Maintain / Lean gain / Gain fast"; factors 0.75 / 0.88 / 1.00 / 1.10 / 1.20.
2. **Goal control:** a draggable **slider** (5 stops).
3. **Custom provider:** primary **+** fallback.
4. **Model lists:** curated best-effort + `Custom…` escape hatch (accepted).

### 13.6 Extra fixes bundled with this batch (confirmed)

5. **Bot "typing"/progress feedback** when a photo is sent — the bot should show it's working (e.g. Telegram `sendChatAction: 'typing'` / `upload_photo`, and/or an immediate "Analyzing your meal…" message that's followed by the result) so the user isn't left wondering. Implement in `apps/worker/src/routes/webhook.ts` `handlePhoto` (send the action before analysis; `TelegramBotClient` needs a `sendChatAction` method). Keep it best-effort (never block/fail the log).
6. **Day grouping must use the user's local time, not UTC.** Bug: a photo at 12:30am local was filed under "yesterday". Root cause: day keys are computed with `toISOString().slice(0,10)` (UTC) in several places — worker `groupByDay`/`GET /api/meals?date=`/`GET /api/meals/dates` and the Mini App. Fix: the client owns "today"/day boundaries in **local** time and passes an explicit date (already does for `mealsByDate`) — but the worker filters by UTC day. **Approach:** have the client send its UTC offset (or compute day membership client-side). Simplest robust fix: worker returns meals with `loggedAt` (epoch ms, already UTC-correct) and the **client** buckets by local day (it already fetches per-date). Ensure `DateSelector` "today", `mealsByDate` filtering, and `mealDates` all use local-time keys consistently. Verify the whole path: `HomeScreen.todayKey()` (local ✓), worker `?date=` filter (currently UTC ✗ → switch to offset-aware or move filtering client-side), `GET /api/meals/dates` (UTC ✗). Add a test around a near-midnight timestamp.
7. **Swipe-delete icon still too far left** — nudge the trash icon further right so it reads centered in the revealed strip. Tune `SwipeableRow` (increase the icon's left offset / center within the visible area more accurately).
8. **Say "Gemini", not "Google Gemini"** — update `PROVIDER_PRESETS.gemini.label` to `Gemini` (flows to all provider dropdowns, meal-card provider labels, key guide title).

### 13.5 Build order (once confirmed)

1. Core: `ProviderPreset.models`; 5-stage `Goal` + `GOAL_FACTORS` + legacy mapping; `createProvider` custom support. Tests. Build core.
2. Worker: settings read/write for custom base URL (+ fallback); `providerFactory`/revise pass-through; keep accepting any model string. Tests. Deploy + (no migration expected).
3. Mini App: model `<select>` + Custom… (primary + fallback); 5-stop goal slider in `ProfileForm`; custom-provider fields in Settings; update `api`/`backend` types. Tests + build. Deploy.
4. Update README (§ AI providers + targets) + this section (mark delivered); commit + push.


---

## 14. Observability + user feedback (DELIVERED)

> **DELIVERED.** D1 `error_logs` + `feedback` tables (migration 0004, applied local + remote).
> `db/errors.ts` (`logError` best-effort/never-throws + `console.error` mirror + Sentry-hook comment,
> `recentErrors`, `describeError`) and `db/feedback.ts` (`storeFeedback`, `recentFeedback`).
> `ADMIN_TELEGRAM_ID` env + `parseAdminId`. `logError` wired into the webhook photo path (with a
> best-effort admin DM) and the `/api/meals/analyze` error path (logged only, no DM). Bot `/feedback`
> (submit + admin no-arg review) and admin-gated `/errors`; `POST /api/feedback` (authed, ≤2000 chars).
> Mini App **Send feedback** dialog in Settings (+ `api.sendFeedback` / `backend.sendFeedback`). Tests:
> core 96, worker 83 (new errors/feedback/webhook cases), miniapp 16, cli 8. Deployed: Worker
> `e32974c0`, Pages `435a1877`. Owner sets the secret via
> `pnpm exec wrangler secret put ADMIN_TELEGRAM_ID` (value `844007785`). Decisions §14.6 confirmed:
> D1 (skip Sentry), DM only on webhook/photo errors, feedback in Settings.

Two needs: (1) **see errors happening to real users**, (2) give users a **way to report problems**.
Chosen approach keeps everything in the existing stack (D1 + Telegram bot) — no new services/secrets
beyond one admin id. Sentry etc. considered but rejected for now (extra dep/account).

### 14.1 New env var
- `ADMIN_TELEGRAM_ID` (number, optional) — the owner's Telegram user id. Gates admin commands and
  is the DM target for error/feedback alerts. Set via `wrangler secret put ADMIN_TELEGRAM_ID`.
  Add to `apps/worker/src/env.ts`.

### 14.2 Error logging (durable, queryable)
- **Migration 0004**: `error_logs` table — `id` (uuid), `created_at` (ms), `telegram_user_id` (int, null),
  `source` (text: 'webhook' | 'api' | 'analyze' | 'revise' | …), `kind` (text, e.g. AIProviderError.kind
  or 'unhandled'), `status` (int, null), `message` (text), `detail` (text, null; provider message / stack snippet).
  Index on `created_at`. Apply local + remote.
- **`apps/worker/src/db/errors.ts`**: `logError(db, evt)` (insert, best-effort — never throws into the
  caller), `recentErrors(db, limit)`.
- **Wire-in**: replace the existing `console.error('photo log failed', …)` in `webhook.ts` with `logError`
  (keep console for `wrangler tail`), and add `logError` to the API error paths (analyze/revise 5xx,
  settings 500). Capture `telegramUserId` where known. Redact secrets — only store provider *messages*,
  never keys (already the case).
- **Admin alert (best-effort, throttled)**: on a logged error, DM `ADMIN_TELEGRAM_ID` a short summary
  ("⚠️ webhook error for user 123: <message>"). Throttle so a burst doesn't spam (e.g. skip if we DM'd
  in the last N seconds — simplest: only alert on webhook/photo errors, which are user-facing, not every
  API 4xx). Never block the user's response.

### 14.3 User feedback channel
- **Migration 0004** (same): `feedback` table — `id`, `created_at`, `telegram_user_id` (int, null),
  `source` ('bot' | 'miniapp'), `message` (text), `handled` (int 0/1 default 0).
- **Bot**: `/feedback <text>` command in `packages/core` `parseUpdate`/`replyForCommand` → the webhook
  stores it + DMs the admin + replies "Thanks, sent!". `/feedback` with no text → prompt for what to type.
  Update `/help` to mention it.
- **Mini App**: a "Send feedback" card/button in Settings → a small dialog (textarea) → `POST /api/feedback`
  `{ message }` (authed) → stores + DMs admin → toast. `api.sendFeedback` + `backend.sendFeedback`
  (local mode: no-op/toast).
- **Worker route**: `POST /api/feedback` (under authed `/api`), length-capped (e.g. ≤2000 chars).

### 14.4 Admin review (gated to ADMIN_TELEGRAM_ID)
- Bot commands (only when `from.id === ADMIN_TELEGRAM_ID`, else treated as normal/unknown):
  - `/errors` → last ~10 error_logs (time, user, source, message).
  - `/feedback` (no args, admin) → last ~10 unhandled feedback entries. (Non-admin `/feedback <text>` = submit.)
  - Keep it read-only + simple; full triage can be a later Mini App admin view if wanted.

### 14.5 Tests
- core: `parseUpdate` handles `/feedback` + args; `replyForCommand` feedback prompt.
- worker: `logError`/`recentErrors` round-trip; `POST /api/feedback` stores + length-cap 400; `/feedback`
  webhook stores + admin DM; `/errors` gated (non-admin gets normal reply, admin gets the list); a webhook
  error writes an error_logs row.

### 14.6 Decisions (please confirm)
1. **Admin id**: I'll add `ADMIN_TELEGRAM_ID` as a secret — you'll run `wrangler secret put ADMIN_TELEGRAM_ID`
   with your Telegram numeric id. OK? (Without it, error DMs + admin commands are simply disabled; storage still works.)
2. **Error DM noise**: alert the admin only on **user-facing webhook/photo errors** (not every API 4xx), to
   avoid spam. Full history always in `/errors`. OK? *(Default: yes.)*
3. **Sentry**: skip external error tracking for now, use D1. OK? *(Default: yes — can add later.)*
4. **Feedback placement in Mini App**: a "Send feedback" button in **Settings** (near privacy). OK? *(Default: yes.)*

### 14.7 Build order (once confirmed)
1. Migration 0004 (`error_logs` + `feedback`) + `db/errors.ts` + `db/feedback.ts`; apply local+remote.
2. `env.ts` `ADMIN_TELEGRAM_ID`; `logError` wired into webhook + API error paths + best-effort admin DM.
3. core: `/feedback` parsing + help text; worker `POST /api/feedback`; `/feedback` + `/errors` bot handlers (admin-gated).
4. Mini App: Settings "Send feedback" dialog + `api`/`backend` methods.
5. Tests; deploy Worker + Pages; `wrangler secret put ADMIN_TELEGRAM_ID`; update README + this section; commit + push.

## 15. Chat editing, text-revise, reminders, onboarding key + manual logging (DELIVERED)

Five related features:

1. **Edit the confirmation in place.** The bot's "📸 Analyzing…" message is EDITED into the
   result (and into errors), so it's one transforming message. Bot client gained `editMessageText`
   / `deleteMessage` and `sendMessage` now returns the `message_id`.
2. **Plain text / reply = AI-revise the last meal.** Non-command text re-runs the AI on the target
   meal, saves it, and edits its confirmation in place. Targeting: a reply wins; else the single
   meal in the last 15 min; else (2+) the bot asks the user to reply to the specific one. Needs a
   key (else a nudge). Meal→confirmation link stored via migration 0005 (`telegram_chat_id`,
   `telegram_message_id`); `parseUpdate` now captures `message_id` + `reply_to_message`.
3. **Multi-photo disambiguation.** Each photo is its own meal/message; ambiguity only affects text
   revise, handled by the reply-to prompt above.
4. **Opt-in meal reminders.** Cloudflare Cron (`*/15 * * * *`) → `scheduled` → `runReminders`.
   Fixed daily slots (breakfast/lunch/dinner) in the user's local tz, deduped per slot per day via
   `lastSent`. Pure due-logic in `@foodlog/core` (`dueReminderSlots`). Config in `preferences_json`;
   `PUT /api/settings/reminders`; Mini App Settings "Meal reminders" card.
5. **Onboarding key step + manual logging.** After the profile step, worker-mode onboarding offers
   an optional "add your AI key" step (skippable, framed as "track manually instead"). `buildManualMeal`
   in core + a Mini App "Add meal" dialog (name + macros) that saves via `POST /api/meals` — no key
   required. The photo bot still needs a key; manual tracking never does.

Tests: core 110, worker 92, miniapp 16, cli 8. Deployed Worker `8e29244d` (cron live), Pages
`f0b045a2`. Migration 0005 applied local + remote.
