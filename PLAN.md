# FoodLog — Implementation Plan

A Telegram-native, low-friction, AI-assisted food/nutrition logging application.

> **One-line goal:** Unlock phone → open FoodLog → take a photo → AI analyzes it → confirm/correct → saved.

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
