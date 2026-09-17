# FoodLog — Implementation Plan

A Telegram-native, low-friction, AI-assisted food/nutrition logging application.

> **One-line goal:** Send a meal photo to the FoodLog bot → AI analyzes it → logged → review/correct in the Mini App.

---

## 1. Confirmed Decisions

These were locked in during the design Q&A and drive every downstream choice.

| Area | Decision |
|------|----------|
| **Architecture** | Server-side BYOK (hybrid leaning server-side). API key stored **encrypted** in D1; all AI calls proxied through a Cloudflare Worker. |
| **Images** | Transit-but-don't-persist. Mini App uploads a downscaled photo to the Worker; Worker forwards it inline (base64 data URL) to the AI; bytes are discarded after analysis. Only the Telegram `file_id` (when available) is persisted. |
| **AI provider** | `deepseek-flash` (DeepSeek-V4.1-Flash) via the OpenAI-compatible endpoint `https://api.deepseek.com`, behind a provider-agnostic `AIProvider` interface. **DeepSeek only** for now; OpenAI adapter stubbed behind the same interface, not yet built. |
| **Nutrition** | Hybrid. AI returns structured foods + rough nutrition; Worker prefers a bundled local per-100g table and falls back to the AI estimate. Every value is source-labeled (`table` \| `ai_estimate` \| `mixed`) and shown as an estimate. |
| **Phase 1** | Build **both** a standalone local CLI harness and a Mini App UI on a mocked processor, sharing `packages/core`. |
| **Repo** | **Monorepo** with a transport-agnostic `packages/core`. |
| **Source control** | Git from the start, commit per task. |

---

## 2. Verified Technical Facts (DeepSeek docs)

- `deepseek-flash` supports **Vision**, **JSON output**, and **Tool Calls** — the three features the pipeline needs.
- Legacy name `deepseek-v4-flash-vision-exp` is accepted but retired (served by V4.1-Flash).
- Inline **base64 `image_url` data URLs** are supported → no image hosting/staging required.
- `detail: "low"` downscales to 512×512; hard cap of **~1024 tokens per image** → a photo costs ≈ **$0.0003** (cache-miss, off-peak). Vision is effectively free for the user.
- Images are only allowed in **user** messages (system/assistant image → HTTP 400).
- Request body limit 48 MiB inline; we downscale client-side to well under 1 MB anyway.
- DeepSeek exposes an **OpenAI-format base URL**, so one adapter covers both OpenAI and DeepSeek with a different base URL + model name.

---

## 3. Architecture

```text
                         TELEGRAM
                            │
                 ┌──────────┴──────────┐
                 │                     │
           Telegram Bot           Mini App (React)
        (thin launcher +          camera → confirm → history
         notification feed)       search → analytics → settings
                 │                     │
                 │ webhook             │ HTTPS (initData-signed)
                 └──────────┬──────────┘
                            ▼
                  Cloudflare Worker (Hono)
              ┌──────── uses packages/core ────────┐
              │  validate initData / webhook       │
              │  AIProvider.analyzeMeal(image)     │
              │  nutrition resolve (table → ai)    │
              │  meal persistence                  │
              └────────────┬───────────┬───────────┘
                           │           │
                    User's AI key    D1 (SQLite)
                    (decrypted        users/settings/
                     in-Worker)       meals/food_items/nutrition
```

**Why server-side over fully client-side:** a browser-held BYOK key is exposed to the user's own devices and any XSS; most AI providers block browser-origin calls via CORS; and the client can't process bot-sent photos. Server-side proxying keeps the key out of the client, enables cross-device history, and still costs ~$0 because inference runs on the user's key.

---

## 4. Tech Stack

- **`packages/core`** — TypeScript, **zero** platform imports. Zod schemas, prompt builder, `AIProvider` interface + adapters, nutrition resolver + bundled table, meal domain logic. Tested with Vitest.
- **`apps/worker`** — Cloudflare Worker + **Hono** router, **D1** (Drizzle ORM), Telegram `initData` verification, webhook handler. Wrangler for local/deploy.
- **`apps/miniapp`** — React + TypeScript + Vite, `@telegram-apps/sdk`, hosted on Cloudflare Pages. Client-side image downscale (canvas) before upload.
- **Tooling** — pnpm workspaces, TypeScript project references, Vitest, Biome.

---

## 5. Database Schema (D1 / SQLite via Drizzle)

```text
users(id PK, telegram_user_id UNIQUE, created_at)
settings(user_id PK/FK, ai_provider, api_key_ciphertext, api_key_iv, preferences_json, updated_at)
meals(id PK, user_id FK, telegram_file_id NULL, notes, confidence, created_at, logged_at)
food_items(id PK, meal_id FK, name, estimated_weight_g, portion, quantity, confidence)
nutrition(meal_id PK/FK, energy_kcal, protein_g, carbs_g, fat_g, source)  -- source: table|ai_estimate|mixed
```

Indexes: `meals(user_id, logged_at)`, `food_items(meal_id)`, and a search index over `food_items.name` (LIKE/FTS) so search never needs an AI call.

---

## 6. AI Processing Pipeline (in `packages/core`)

```text
image bytes
  → build multimodal request
      system: JSON schema instructions
      user:   text + image_url data URL, detail:"low"
  → AIProvider.analyzeMeal()             [DeepSeek adapter]
  → Zod-validate { foods[], confidence, needs_confirmation }
  → nutrition resolver: per food, table match by grams → else AI estimate, tag source
  → MealResult (draft, editable)
```

The prompt never asks "how many calories" directly; foods and portions come first, nutrition is resolved afterward.

---

## 7. Cross-Cutting Concerns

- **BYOK security:** key submitted over HTTPS, encrypted with **AES-GCM** (WebCrypto) using a Worker secret; store ciphertext + IV. Never store plaintext, never return the key (show only "✓ Connected" + last 4). Decrypt in-memory per request; never log.
- **Image handling:** client downscale → base64 → Worker → inline to AI → discard. Persist only `file_id`. R2 deferred until a permanent gallery is actually needed.
- **History / Search / Analytics:** all from stored structured rows via SQL — no AI calls. Charts rendered client-side.
- **Cost:** Bot free; Pages free; Worker + D1 free tiers; no image storage; AI on user's key (~$0.0003/photo).
- **Migration to Telegram-native serverless (Phase 6):** because `packages/core` has no Telegram/Worker imports, migration = a new thin adapter over the same `core`. Prompts, schema, nutrition, history, search, analytics, and UI stay unchanged.

---

## 8. Task Breakdown

Each task is a working, demoable increment that builds on the last. No orphaned code.

1. **Monorepo + `packages/core` skeleton** — pnpm workspaces, TS project refs, Vitest, Biome. Zod schemas (`FoodItem`, `AIFoodAnalysis`, `MealResult`, `NutritionValue` with `source`) + types. Tests: schema parse/reject. *Demo: `pnpm test` passes; types importable.*
2. **`AIProvider` interface + DeepSeek adapter (mockable fetch)** — `analyzeMeal(image, opts)`; OpenAI-compatible request with `image_url` data URL, `detail:"low"`, JSON output. Tests vs mocked fetch. *Demo: request/parse proven without network.*
3. **Nutrition resolver + bundled per-100g table** — scale by grams, table-first with AI fallback, source tagging, meal aggregation. Tests: hit/miss/mixed/scaling. *Demo: sample foods JSON → labeled `MealResult`.*
4. **Local CLI harness** — image path → analyzeMeal → nutrition → printed `MealResult`. Mock provider by default, real DeepSeek via env flag/key. *Demo: run on a sample photo end-to-end.*
5. **Mini App shell + camera flow on mock processor** — React+Vite+Telegram SDK, camera-first home, capture, client downscale, editable confirm screen labeled "AI estimate". *Demo: full photo→confirm→(local) save with mock data, no backend.*
6. **Worker + D1 + Drizzle + auth** — Hono app, D1 schema/migrations, `initData` HMAC verification, `GET /api/me`. Tests: valid/invalid initData, migration applies. *Demo: authenticated request returns the user; bad initData rejected.*
7. **Settings + encrypted BYOK** — `PUT/GET /api/settings`, AES-GCM encrypt/decrypt, test-connection; never return plaintext. Tests: round-trip, redaction. *Demo: save key, see "✓ Connected", stored as ciphertext.*
8. **`analyze` + `save` endpoints (real pipeline)** — `POST /api/meals/analyze` (discard bytes) and `POST /api/meals`. Wire Mini App off the mock onto the real Worker. Tests: analyze happy/error, persistence. *Demo: real photo→AI→confirm→saved in D1, cross-device.*
9. **History + detail + search** — `GET /api/meals` (grouped), `GET /api/meals/:id`, `GET /api/search?q=`; Mini App screens; image via `file_id`. Tests: grouping, search SQL. *Demo: browse & search past meals.*
10. **Analytics** — aggregate SQL endpoints (counts, common foods, macro trends); Mini App charts. Tests: aggregation. *Demo: analytics screen from stored data, no AI.*
11. **Bot launcher + notification feed** — `/start /help /settings`, web_app launch button, post-save "logged" message; webhook handler reusing `core`. Tests: webhook parse/verify. *Demo: `/start` opens Mini App; saving posts a feed message.*
12. **Polish + privacy + data control** — loading/retry/error states, confidence handling, data export, data deletion (cascade), a clear privacy explanation. Tests: deletion cascade, export shape. *Demo: export and fully delete account data; graceful failures.*

Phases 1–5 map to Tasks 1–12; **Phase 6** (Telegram-native serverless) is a future adapter over `core`, deliberately out of build scope until that product's API is verifiable.

---

## 9. Design Principles

- `packages/core` stays transport-agnostic — no Telegram, no Worker, no D1 imports. This is what makes Phase 6 migration cheap.
- AI nutrition is always presented as an **estimate** and is always **correctable**.
- Deterministic where possible (local nutrition table, SQL analytics/search); AI only for what genuinely needs vision.
- No feature designed around extreme calorie restriction; this is a logging tool.
- Never claim "private" or "zero data collection" beyond what the architecture actually guarantees.

---

## 10. Progress Log & Roadmap (living section)

This section tracks what was actually built, including work beyond the original 12-task breakdown, plus what's planned next. Updated as the project evolves.

### Delivered

**Tasks 1–12 (core build), all with tests, typecheck, and per-task commits:**
1. Monorepo + `packages/core` (pnpm workspaces, TS project refs, Vitest, Biome) + Zod schemas.
2. `AIProvider` interface + DeepSeek adapter (OpenAI-compatible, inline base64 `image_url`, JSON mode). Verified against the real API.
3. Nutrition resolver + bundled per-100g table (table-first, AI fallback, source-tagged, aggregation).
4. Local CLI harness (mock default, real DeepSeek via `--real`).
5. Mini App shell + camera flow on the mock processor (React 19 + Vite 6 + `@telegram-apps/sdk-react`, client-side canvas downscale, editable confirm screen).
6. Worker + D1 + Drizzle + Telegram `initData` HMAC auth + `GET /api/me`. Tested against Miniflare D1.
7. Settings + encrypted BYOK (AES-256-GCM, ciphertext+IV stored, key never returned/logged).
8. `analyze` + `save` endpoints (real pipeline); Mini App wired onto the Worker with a local fallback.
9. History + detail + search (owner-scoped, day-grouped, LIKE search with escaped wildcards).
10. Analytics (aggregate SQL only — totals, daily trend, common foods, macro averages).
11. Bot launcher + notification feed (webhook, `/start /help /settings`, web_app launch button, post-save message).
12. Privacy + data control — `GET /api/account/export` (full owner-scoped JSON: meals, foods, per-food + total nutrition, notes, timestamps, and the provider/model preference; **never** the encrypted API key) and `DELETE /api/account` (deletes the `users` row, cascading to settings/meals/food_items/nutrition). Mini App Settings gained a privacy-explanation card, an "Export my data" download (JSON blob), and a "Delete account" confirm dialog. Tests: export has data but no secrets, delete cascades and leaves a fresh empty user, other users untouched.

**Extras delivered beyond the original plan:**
- **Full meal CRUD** — `PUT`/`DELETE /api/meals/:id` (owner-scoped, cascade delete verified); editable + deletable meal detail screen in the Mini App.
- **Settings screen in the Mini App** — enter/replace the BYOK key; shows connection status + last 4.
- **Editable macros** — per-food manual override (`manual` nutrition source) used verbatim, editable in the detail screen.
- **Bot-photo auto-log** — send a photo straight to the bot chat; the Worker downloads via `getFile`, runs the pipeline with the user's key, saves with the Telegram `file_id`, and replies with a summary + launch button.
- **Photos in logs** — `GET /api/meal-photo/:id` proxies the Telegram image (bot token stays server-side; `initData` verified via query param); thumbnails in history/recent, full photo in detail.
- **Deployed to production** — Worker on `workers.dev`, Mini App on Cloudflare Pages, D1 in APAC, webhook registered. The Mini App is configured as the bot's **Main Mini App** in BotFather (launches from the profile "Open App" button); commands/description/about set in BotFather. All on free tiers (AI on the user's key).

### In progress

_(nothing actively in progress)_

### Changed

- **Multi-provider AI (delivered).** Generalized the adapter to any OpenAI-compatible endpoint with presets for **Gemini (default), OpenAI, DeepSeek**; provider + model selectable in Settings; image detail raised to `high`. Default model kept current (`gemini-3.6-flash`) since Gemini retires names.
- **Mini App photo capture removed.** Because Mini-App uploads can't retain an image for free (bytes are discarded; no Telegram `file_id`), the camera/upload + confirm flow was removed. Logging is now bot-only (photo → auto-log, photo kept). Removed `ConfirmScreen`, `image.ts` downscale, and `MealProcessor` from the app layer.
- **Per-food nutrition persisted.** `food_items` now stores each food's kcal/P/C/F + source; the detail screen shows stored values instead of re-deriving, so multi-food meals keep every food's macros.
- **Mini App rebuilt on shadcn/ui + Tailwind CSS v4.** The whole presentation layer was moved to shadcn components (Card, Button, Dialog, Tabs, Input, Skeleton, Badge) with Sonner toasts and lucide icons; the Telegram theme drives the shadcn color tokens at runtime. Kept: native BackButton/MainButton + haptics on the detail screen, macro icons (🔥/🥩/🍚/🧈), skeletons, empty states, and a home daily-summary card. **Swipe-between-tabs was removed** (choppy hand-rolled version); tabs are tap-only. **Swipe-to-delete** on history rows was rebuilt on `react-swipeable` so it works on both touch and mouse. The earlier hand-rolled `gesture.ts`/`toast.ts` and the client canvas downscale were removed.

- **Bot copy synced to the real flow + Main Mini App.** Switched the bot to a **Main Mini App** in BotFather, so it launches from the profile "Open App" button rather than a chat menu button. Updated the `/start`, `/help`, and fallback replies (in `packages/core`) to describe the actual bot-only flow — *send a photo straight to the chat to log it; open the app to review/correct, browse history, search, and trends* — instead of the old "open the app and take a photo" wording. Launch-button label is now 🍽️ Open FoodLog.

### Future / backlog

- **R2 photo storage for Mini-App captures** so in-app photos persist like bot photos (currently only bot-sent photos keep an image). Deferred in the original plan until a gallery is actually needed.
- **In-chat confirm/edit** — inline "Looks good / Edit" buttons on the bot auto-log reply, so corrections don't require opening the app.
- **Goals & streaks** — daily calorie/protein targets, progress ring, logging streaks.
- **Phase 6 (Telegram-native serverless)** — a future thin adapter over the same `packages/core`, per the original design.

### Design principles (unchanged)

`packages/core` stays transport-agnostic. AI nutrition is always an estimate and always correctable. Deterministic where possible (local table, SQL analytics/search). No feature designed around extreme calorie restriction. Never claim privacy beyond what the architecture guarantees.

---

## 11. Home-centric redesign + AI meal editing + performance (DELIVERED)

> **Status: shipped & deployed.** All five goals below are live (Worker version `0082beef`, Pages redeployed). Tests green across the workspace: core 76, cli 8, miniapp 15, worker 53. See §11.6 for exactly what shipped.

This section is the design for the batch of work. Goals, in the user's words:

1. Remove the **History** and **Search** tabs.
2. On the home page, make the **top a clickable calendar** to pick a day; the list below shows that day's meals.
3. Each meal row supports **swipe-left to delete**.
4. Each meal row gets an **"Update with AI"** action: the user types a plain-language instruction ("add a coke", "the rice was double", "remove the fries") and the AI rewrites that meal log itself.
5. The app **loads slowly** today — introduce **lazy loading** (code-splitting + lighter initial fetch) so first paint is fast.

### 11.1 Current state (why these changes are safe)

- Navigation is state-driven in `App.tsx` (no router): a `Tab` union + a static `NAV` array + shadcn `Tabs`. Meal detail is an early-return overlay keyed by `detailId`, opened via `onOpenMeal(id)`.
- Home (`HomeScreen.tsx`) receives `recent: RecentMeal[]` from App (App fetches once via `backend.recent()` → `GET /api/meals`, which returns the **full** meal list; Home slices to 5). History reuses the same full `GET /api/meals` (via `groups`). So the initial load fetches **all** meals for a 5-item list — a core cause of slow load.
- `SwipeableRow.tsx` (react-swipeable, `trackMouse`) is used **only** by `HistoryScreen`. Removing History leaves it free to reuse on Home.
- Meal editing (`MealDetailScreen.tsx`) is **manual only** — client-side field edits + `resolveFoodNutrition`/`aggregate`, saved via `backend.update` → `PUT /api/meals/:id`. There is **no AI on update** today. The only AI path is `POST /api/meals/analyze` (image → analysis), via `AIProvider.analyzeMeal`.
- No code-splitting anywhere (no `React.lazy`/`Suspense`/dynamic import; no `manualChunks` in `vite.config.ts`) — everything (all screens + charts + swipe lib) ships in one chunk.

### 11.2 Target UX

- **Two tabs only:** **Home** and **Settings**. (Analytics/"Stats" — decision below.) The bottom nav shrinks accordingly.
- **Home = a day view.** Top: a compact, clickable **date selector** (a "‹ Wed, Sep 17 ›" pill that opens a calendar popover; prev/next arrows step days). Below the date: that day's **total kcal + macro summary**, then the **list of meals logged that day**, newest first. The static "log a meal by sending a photo to the bot" hint stays (as an empty-state when a day has no meals).
- **Swipe-left-to-delete** on each meal row (reuse `SwipeableRow`), with the existing confirm/haptic/toast pattern.
- **"Update with AI"** control on each meal row (and/or on the detail screen): tapping it opens a small input ("Describe the change…"), the user types free text, and on submit the app calls a new endpoint that returns a revised meal, which replaces the log. Optimistic toast + refresh.

### 11.3 Changes by area

**A. Remove History + Search (front-end only)**
- `App.tsx`: drop `'history'`/`'search'` from the `Tab` union and `NAV`; remove their `TabsContent` blocks and the `HistoryScreen`/`SearchScreen` imports; remove now-unused icons (`SearchIcon`, and `UtensilsCrossed` if unused after redesign).
- Delete `components/HistoryScreen.tsx` and `components/SearchScreen.tsx`.
- Keep `SwipeableRow.tsx` (now used by Home).
- Backend interface: **keep** `history()` (Home's day view can reuse it) but **remove** `search()` from the interface + worker/local impls **and** the unused `api.search`. Update `backend.test.ts` (drop the search test).
- Worker: leave `GET /api/search` route in place for now (harmless, tested) OR remove it + its test. **Decision: remove** `GET /api/search`, its `searchMeals` DB helper, and `search.test.ts` cases, to avoid dead code. (If we later want in-app search back, it's a small re-add.)

**B. Home day view + clickable calendar**
- New `components/DayPicker.tsx`: a date pill + prev/next arrows + a calendar popover. Implementation: add shadcn **`calendar`** (react-day-picker) + **`popover`** (Radix) components (both are standard shadcn additions; `react-day-picker` + `@radix-ui/react-popover` are new deps). Highlight days that have meals (needs a set of logged dates — see data below).
- Rework `HomeScreen.tsx` to own a `selectedDate` state (default today). Render: DayPicker at top → day summary (kcal + `MacroLine`) → meals for that date, each in a `SwipeableRow` (delete) with an "Update with AI" affordance. Empty day → the send-a-photo hint.
- Data: reuse `HistoryDay[]` from `backend.history()` and filter to `selectedDate` client-side (simple, no new endpoint) **for now**; the calendar's "has meals" dots come from the set of `day.date` values. (A dedicated `GET /api/meals/day?date=` endpoint is a later optimization; see performance below.)
- Local (browser-dev) mode keeps working via `groupSavedByDay`.

**C. Swipe-to-delete on Home**
- Reuse `SwipeableRow` exactly as History used it: wrap each meal card, `onDelete` → `backend.remove(id)` → refresh + toast + haptic. No new code beyond wiring.

**D. "Update with AI" (the meaningful new capability)**
- **Core (`packages/core`):** extend the AI layer with a **text-only revise** capability. Add `reviseMeal(current: MealResult | AIFoodAnalysis, instruction: string, opts?)` to `AIProvider` (default-implemented on `OpenAICompatibleProvider`): sends a Chat Completions request (JSON mode, **no image**) with a new system prompt that says "here is the current structured meal; apply the user's instruction; return the same schema." Reuse `AIFoodAnalysis`/`MealResult` Zod validation on the response. The free-text instruction is treated as **data**, never as system instructions (same stance as the photo `hint`). New prompt lives beside `prompt.ts`.
- **Worker:** new route `POST /api/meals/:id/revise` (owner-scoped, under `/api`). Body `{ instruction: string }`. Steps: load the meal detail (owned), decrypt the user's key, build the provider via `createProvider`, call `reviseMeal(currentMeal, instruction)`, run the result through the **same nutrition resolver** used by analyze/save so table-vs-AI sourcing stays consistent, then `updateMeal(...)` (the existing atomic replace) and return the new `MealDetail`. Errors surface like the webhook's (real provider message, 400/402/500 as appropriate). Rate/length guard the instruction (e.g. cap length).
- **Mini App:** `ApiClient.reviseMeal(id, instruction)` → `POST /api/meals/:id/revise`; `Backend.reviseWithAi(id, instruction)` (worker mode calls the API; **local mode** does a minimal mock or throws "AI edit needs the backend"). UI: an "✨ Update with AI" button on the meal row / detail that opens an input + submit; on success replace the row and toast. Show a spinner while the model runs (it's a network + LLM call).
- **Tests:** core — `reviseMeal` builds a no-image JSON request and validates output (mock fetch), instruction-as-data. Worker — `revise` route: owned meal revised + persisted, not-owned → 404, missing key → 402/400, bad instruction → 400.

**E. Performance / lazy loading**
- **Code-split screens** with `React.lazy` + `Suspense`: `AnalyticsScreen` (pulls in the chart code), `SettingsScreen`, and `MealDetailScreen` become lazy chunks so the initial bundle is basically Home + nav. Add a lightweight `Suspense` fallback (existing `Skeleton`).
- **Lighter first fetch:** today App fetches **all** meals on load for a 5-item Home. Options: (i) add `GET /api/meals?limit=N&before=…` (paginated) and a `GET /api/meals/dates` (distinct logged dates for the calendar dots), fetching only the selected day + recent; or (ii) short-term, keep one fetch but defer it behind first paint and cache. **Decision: do (i)** — add a `limit`/`date` query to `GET /api/meals` (default to recent N) and a small `dates` endpoint; Home fetches the selected day on demand. This removes the "load everything" cost. Keep `history()` for local mode.
- **Vite:** rely on route-level `React.lazy` for chunking (no manual `manualChunks` needed initially). Verify the built output splits into multiple chunks and the main chunk shrinks. Consider `build.rollupOptions` only if a vendor split is still too big.
- Telegram init + theme already run before mount; keep that. Ensure the first meaningful paint doesn't block on the meals fetch (render the day scaffold + skeletons immediately).

### 11.4 Decisions (confirmed)

1. **Remove the Stats/Analytics tab too** — the day view shows per-day totals; final tabs are **Home + Settings** only. (Keep `AnalyticsScreen.tsx` file out of the app; may delete it. The worker `GET /api/analytics` can stay or be removed — remove for cleanliness.)
2. **"Update with AI" on both** the Home meal row and the detail screen.
3. **AI edit shows a spinner** and is treated like analyze (a real LLM call on the user's key).
4. **Fully remove** the in-app search endpoint + UI.

### 11.5 Build order (once confirmed)

1. Core: `reviseMeal` + revise prompt + tests. Build core.
2. Worker: `POST /api/meals/:id/revise` (+ resolver reuse) + `GET /api/meals` `limit`/`date` + `dates` endpoint; remove `GET /api/search`. Tests. Deploy.
3. Mini App: remove History/Search; new `DayPicker` (shadcn calendar+popover); rework `HomeScreen` (day view + swipe-delete + Update-with-AI); `React.lazy` for Analytics/Settings/MealDetail; api/backend methods. Tests + build.
4. Verify workspace typecheck + all tests + build; deploy Worker + Pages; update README + this section (mark delivered); commit + push. No DB migration needed (schema unchanged).

### 11.6 What shipped (delivered)

- **Core:** `AIProvider.reviseMeal(current, instruction, opts?)` (text-only, no image) on `OpenAICompatibleProvider` (shared `#complete()` with `analyzeMeal`) + `MockAIProvider.reviseMeal`. New `REVISE_SYSTEM_PROMPT` + `buildRevisePrompt()` (instruction sent as data, not instructions). Output validated as `AIFoodAnalysis`. `ReviseMealInput`/`ReviseMealOptions` types. Tests in `ai/revise.test.ts`.
- **Worker:** `POST /api/meals/:id/revise` — owner-scoped, decrypts the user's key, `reviseMeal(detailToAnalysis(detail), instruction)`, re-runs `resolveMeal`, `updateMeal` (atomic replace), returns the fresh `MealDetail`. Instruction guarded (non-empty, ≤500 chars). `detailToAnalysis()` reverses stored absolute macros back to per-100g `aiNutrition`. `GET /api/meals?date=YYYY-MM-DD` + `GET /api/meals/dates` for the day view. **Removed** `GET /api/search` (+ `searchMeals`) and the entire `/api/analytics` route + `db/analytics.ts`.
- **Mini App:** two tabs (**Home**, **Settings**). Home is a day view: `DateSelector` (prev/next + calendar popover, logged-day dots, future days disabled) → day totals → meals list; each row has **swipe-to-delete** (`SwipeableRow`) and an **Update-with-AI** icon. `MealDetailScreen` gained an Update-with-AI button. New `UpdateWithAi` dialog (plain-text input, spinner). New shadcn `popover` + `calendar` (react-day-picker v9). `React.lazy` for Settings + MealDetail; the calendar chunk loads on demand. Deleted `HistoryScreen`, `SearchScreen`, `AnalyticsScreen`, and `lib/summary.*`. `backend.reviseWithAi` / `mealsByDate` / `mealDates`; `search`/`analytics`/`history` removed from the data layer (local mode still works; local AI-edit surfaces "needs the backend").
- **Perf:** initial bundle no longer fetches every meal (Home loads just the selected day) and no longer ships Settings/MealDetail/calendar up front — main chunk dropped ~529kB→455kB, with lazy chunks for calendar (73kB), MealDetail (9kB), Settings (7kB).
- **Notes:** no DB migration (schema unchanged). New deps: `@radix-ui/react-popover`, `react-day-picker` (v9).

### 11.7 Follow-up: revise timeouts (fixes Gemini 524 / stuck "Updating…")

The AI revise could hang the UI on a static "Updating…" when the provider was slow — Gemini occasionally returned a **524** (Cloudflare cut the connection at its ~100s edge limit because the Worker's provider fetch had no timeout). Fixes:
- **Worker:** the revise call now runs under a 45s `AbortController`; on timeout it returns a clean **504** ("Revision timed out") instead of letting the edge 524. The `signal` is threaded into the provider's `fetch`.
- **Mini App:** `ApiClient` bounds every request (default 20s; AI calls analyze/revise 60s) via an `AbortController`, throwing a clear `ApiError` on timeout/network so the dialog never hangs.
- **UpdateWithAi UI:** the dialog now shows a spinner + a cycling status message ("Reading your meal…" → "Asking the AI…" → "Recalculating nutrition…" → "Almost there…") so it visibly progresses. Works the same whether launched via the Main Mini App, an inline button, or the chat **menu button** (all pass `initData`).

---

## 12. Goals, onboarding & daily targets with progress rings (PLANNED)

Plan-only — nothing built yet. Goals, in the user's words:

1. Research how to compute a user's daily calorie need from their goal (done — see §12.1).
2. **Onboarding**: if the user hasn't entered their profile, show an onboarding flow on first open.
3. If a profile exists, let the user **edit it in Settings**.
4. Home page shows **remaining calories for the day** as a **ring**, and the same for **protein, carbs, and fat**.

### 12.1 The math (researched)

Uses the **Mifflin-St Jeor** BMR equation ([AJCN 1990](https://tdeecalculator.org/bmr-calculator/)) and standard TDEE activity multipliers ([guide](https://tdeecalculator.org/activity-level-guide/)). *Content rephrased for licensing compliance.*

- **BMR** = `10·weightKg + 6.25·heightCm − 5·age + s`, where `s = +5` for male, `−161` for female.
- **TDEE** = `BMR × activityFactor`:
  - sedentary `1.2`, light `1.375`, moderate `1.55`, active `1.725`, very active `1.9`.
- **Goal → calorie target** (applied to TDEE):
  - **lose** → `TDEE × 0.80` (a ~20% deficit),
  - **maintain** → `TDEE`,
  - **gain** → `TDEE × 1.10` (a ~10% surplus).
  - Rounded to the nearest 10 kcal. Floor at a safe minimum (e.g. ≥1200 kcal) to avoid unhealthy targets.
- **Macros** (from the calorie target + bodyweight):
  - **protein** = `1.8 g × weightKg` (mid of the common 1.6–2.2 g/kg range),
  - **fat** = `25%` of calories `÷ 9`,
  - **carbs** = remaining calories `÷ 4` (after protein & fat kcal), floored at 0.
  - All rounded to whole grams.
- These are **estimates**, shown as guidance and fully overridable — same stance as nutrition. Never framed around extreme restriction.

All of this is **pure, deterministic, and transport-agnostic**, so it lives in `packages/core` (new `profile/` module) with unit tests.

### 12.2 Data model (no migration)

The `settings` table already has an unused `preferences_json` TEXT column — store the profile + targets there as JSON. No schema/migration change.

Profile shape (validated with Zod in core):
```
UserProfile {
  sex: 'male' | 'female'
  age: number (years, 13–100)
  heightCm: number
  weightKg: number
  activity: 'sedentary'|'light'|'moderate'|'active'|'very_active'
  goal: 'lose' | 'maintain' | 'gain'
  // optional manual overrides; when set, used instead of computed values
  calorieTargetOverride?: number
  macroOverride?: { proteinG:number; carbsG:number; fatG:number }
}
DailyTargets { energyKcal, proteinG, carbsG, fatG }  // computed
```
Store as `preferences_json = { profile, updatedAt }`. Targets are recomputed from the profile on read (cheap, deterministic) so they never go stale.

### 12.3 Changes by area

**A. Core (`packages/core/profile/`)**
- `UserProfile` Zod schema + `DailyTargets` type.
- `computeBmr(profile)`, `computeTdee(profile)`, `computeTargets(profile): DailyTargets` (applies goal + macro split, honoring overrides). Pure functions + tests (known-value checks against the formulas above).

**B. Worker**
- Settings DB: read/write `preferences_json`. Extend `getSettings` to surface the parsed profile; add a way to persist it.
- Routes: extend `GET /api/settings` to include `profile` (or null) + computed `targets`. Add `PUT /api/settings/profile` (owner-scoped) that validates a `UserProfile` and stores it in `preferences_json`. (Keep the existing key-only `PUT /api/settings`.)
- Tests: profile round-trips; targets computed; invalid profile → 400.

**C. Mini App**
- `api.getSettings()` now returns `profile` + `targets`; `api.saveProfile(profile)`; backend passthrough (`getProfile`/`saveProfile`); **local mode** stores the profile in localStorage.
- **Onboarding**: on load, `App` checks settings; if no `profile`, render a full-screen **OnboardingScreen** (a short multi-step form: sex, age, height, weight, activity, goal → preview computed targets → Save). Blocks the tabs until completed (can't meaningfully show rings without it). After save, drop into Home.
- **Settings**: a "Your profile & goal" card to view/edit the same fields (reuses the onboarding form). Shows the computed daily targets + lets the user override them.
- **Home rings**: a new `ProgressRing` (SVG, themed) + a `MacroRings` block at the top of the day view. For the selected day, compute consumed totals (kcal + P/C/F from that day's meals) and show **remaining = target − consumed** as four rings (kcal big, P/C/F smaller), with over-target handled gracefully (ring caps at 100%, shows "over by N"). Rings use the shadcn/Telegram theme tokens.
  - Consumed macros per day: the day's meals already carry kcal via `MealSummary`; **but P/C/F totals aren't in the list payload today** — so either (i) extend `GET /api/meals?date=` summaries to include `proteinG/carbsG/fatG` (from the stored `nutrition` row), or (ii) sum from details. **Decision: (i)** — add P/C/F to `MealSummary` (cheap, already joined) so the day view can total macros without N extra fetches.

**D. Perf/UX**
- Onboarding + Settings profile form can be part of the existing lazy Settings chunk; Onboarding is only loaded when needed.
- Rings render instantly from the day fetch; no extra round-trip beyond the existing day list (+ the targets that come with settings, fetched once).

### 12.4 Decisions (please confirm)

1. **Onboarding gating:** hard-block the app until the profile is filled, or allow "skip for now" (rings hidden until set)? *Default: allow skip — show a soft prompt on Home ("Set your goal to see targets") so the app is usable immediately; onboarding is one tap away.*
2. **Units:** metric only (kg/cm), or also imperial (lb/ft-in)? *Default: metric only for v1 (simplest, matches the formula); can add a toggle later.*
3. **Goal presets vs custom deficit:** fixed lose/maintain/gain (−20%/0/+10%), or also a custom kcal target? *Default: presets + a manual calorie/macro override field for power users.*
4. **Protein basis:** 1.8 g/kg of current bodyweight (default) — fine, or prefer goal-weight/LBM? *Default: 1.8 g/kg current weight.*

### 12.5 Build order (once confirmed)

1. Core `profile/` (schema + BMR/TDEE/targets) + tests. Build core.
2. Worker: `preferences_json` read/write, `GET /api/settings` (+profile+targets), `PUT /api/settings/profile`, P/C/F in day summaries. Tests. Deploy.
3. Mini App: api/backend profile methods; OnboardingScreen; Settings profile card; ProgressRing + Home rings; wire consumed-vs-target. Tests + build.
4. Verify workspace typecheck + tests + build; deploy Worker + Pages; update README + PLAN §12 (delivered); commit + push. No DB migration.
