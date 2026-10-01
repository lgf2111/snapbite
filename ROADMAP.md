# SnapBite — Roadmap (Visionary)

A forward-looking feature roadmap for SnapBite, grounded in the current codebase and in a scan of
what competing AI calorie trackers ship in 2026 (Cal AI, MacroFactor, Welling, Cronometer,
MyNetDiary, Fitia, NutriScan, and WhatsApp-style coaches like Sunn). It picks up where
the original #1–#15 backlog leaves off — that backlog is fully shipped (see `git log`) — and defines
the *next* set of directions.

Every item is weighed against the two hard product rules (see `.kiro/steering/lightweight.md`):
1. **Stay lightweight** — small bundles, minimal deps, cheap runtime, within Cloudflare's free tier.
2. **BYOK, no server-side AI cost** — AI runs on the user's own key; we never take on per-request
   model cost.

Legend: effort **S** ≈ <½ day · **M** ≈ 1–2 days · **L** ≈ multi-day. "Fit" = how naturally it sits
with SnapBite's lightweight/BYOK DNA.

---

## Market context (why these items)

What recurs as a differentiator across 2026 AI trackers, and where SnapBite stands:

| Capability | Market norm | SnapBite today | Gap |
|---|---|---|---|
| Photo logging | table stakes | ✅ strong | — |
| Label / barcode read | common | ✅ (via vision model + Open Food Facts) | — |
| **Voice / text logging** | nearly universal ("photo·voice·text·barcode") | ⚠️ text only *revises* an existing meal | **big** |
| **Adaptive calorie targets** | MacroFactor's moat | ❌ static Mifflin–St Jeor | **big** |
| **Conversational AI coach** | Welling / Sunn's whole product | ❌ | **big** |
| Weight logging + trend | common | ❌ | medium |
| Fiber / micronutrients | increasingly expected | ❌ (big-3 macros only) | medium |
| Streaks / weekly recap / share | retention mechanics | ⚠️ share-card exists, no streaks/recap | medium |

Two findings worth designing around:
- Independent evaluations put AI calorie error near ~40% on whole meals (worse on mixed dishes),
  with **portion sizing** the weak point ([mynetdiary.com](https://www.mynetdiary.com/ai-calorie-counters-2026.html)).
  SnapBite's "always an editable estimate" stance is an asset — lean into visible confidence and
  one-tap portion correction rather than claiming false precision.
- The apps winning on retention are **conversational** (log by chatting) and **adaptive** (targets
  that move with you). Both map directly onto SnapBite's Telegram-native, BYOK design.

_Sources: [macaron.im](https://macaron.im/blog/best-ai-calorie-tracker-apps-2026),
[welling.ai](https://www.welling.ai/articles/best-ai-nutrition-apps-weight-loss-2026),
[MacroFactor docs](https://help.macrofactorapp.com/en/articles/20-expenditure),
[Cal AI (App Store)](https://apps.apple.com/gb/app/cal-ai-food-calorie-tracker/id6751961894).
Content rephrased for compliance with licensing restrictions._

---

## Tier 1 — high fit, low weight (do first)

### R1. Voice + text meal logging in the bot — effort M, risk low, fit ✅✅
**The headline gap.** Every competitor advertises multi-modal logging; SnapBite only logs via photo
(text/voice currently just *revise* an existing meal via the plain-text handler in `webhook.ts`).

- **Text:** route a plain-text meal description ("two eggs, sourdough, half an avocado") into the
  **existing** analysis pipeline instead of the revise flow. Same prompt builder (`core/ai/prompt.ts`),
  same `AIFoodAnalysis` schema, same nutrition resolver, same per-food macro persistence. The only
  new logic is intent disambiguation: is this message a *new meal* or a *revision of the last one*?
  Reuse the existing "recent meals in the last few minutes" window already used for revise
  disambiguation.
- **Voice:** Telegram delivers a voice note as a downloadable file (like photos today). Lightest path
  is a single multimodal call on the **user's own key** where the provider supports audio (Gemini
  handles audio natively); otherwise reply "couldn't transcribe — type it instead." No bundled STT,
  no new dependency.
- **Why it fits:** reuses the one AI call; no new deps; BYOK preserved. Turns SnapBite into the
  "photo · voice · text" logger the market expects.
- **Touches:** `apps/worker/src/routes/webhook.ts` (new message routing), `packages/core/ai/prompt.ts`
  (a text-only prompt variant), `core/telegram/bot.ts` (reply strings). No schema change.
- **Risks:** intent ambiguity (new vs. revise). Mitigate with the existing recent-meal window + a
  confirming reply. Voice adds a download + possibly-unsupported-provider branch — guard it.

### R2. Adaptive targets — "SnapBite learns your real burn" — effort M, risk low, fit ✅✅
MacroFactor's signature feature, done the deterministic (zero-AI) way.

- **Weight check-ins:** let a user log a bodyweight (send the bot a number like `72.5kg`, or a field
  in the Mini App). Store a small time series — a new `weights` table (`userId`, `ts`, `kg`) or a
  JSON array in `preferences_json` for the lightest start.
- **Trend + expenditure:** compute an **exponentially-smoothed weight trend** (signal vs. daily
  noise), then back out *actual* TDEE from `(trendΔkg × ~7700 kcal/kg) ÷ days` compared with logged
  intake over the same window. All arithmetic, same style as `profile.ts::computeTargets`.
- **Recalibrate:** once a week, nudge the calorie target toward the measured expenditure (with
  smoothing to avoid over-correction). Surface as a one-line check-in ("your real burn looks ~2250,
  I nudged your target to 2000").
- **Why it fits:** pure math over rows you already have (meals = intake) plus a tiny weights store.
  No AI, no deps, trivially within free tier.
- **Touches:** new `core/profile/expenditure.ts` (trend + TDEE math + tests), `webhook.ts` (weight
  entry + weekly nudge, likely folded into the reminders cron), Mini App Settings/Home (optional
  weight field + "adaptive" toggle), D1 migration if using a table.
- **Risks:** needs enough logging consistency to be meaningful — gate it behind an opt-in and show it
  as an estimate (consistent with the product's honesty rule). Keep the fixed Mifflin–St Jeor target
  as the default/fallback.

### R3. Conversational AI coach (`/coach`) — effort M, risk low, fit ✅✅
Welling/Sunn's entire value prop, which SnapBite can offer on the user's own key.

- On `/coach <question>` (or free-text when a coach mode is active), answer using the user's **logged
  rows** as context: today's/this week's totals, target gaps, recent meals. e.g. "you're 14g short on
  protein — a Greek yogurt closes it," or "why is this meal high in carbs?"
- **Why it fits:** reuses the existing provider adapter + BYOK key. Keep the context payload tiny
  (pre-computed totals, not raw history) so the call stays cheap. On-demand only (a command), so no
  background cost.
- **Touches:** `webhook.ts` (new command + a compact context builder from existing meal queries),
  `core/ai` (a chat/coach prompt — text completion, no image), `core/telegram/bot.ts`.
- **Risks:** scope creep into open-ended chat. Keep it anchored to the user's data and nutrition;
  cap context size; it's a feature, not a general chatbot.

### R4. Fiber as a first-class macro — effort S, risk low, fit ✅✅
The most-requested "beyond the big-3" number; Cal AI now leads its store listing with it.

- Add `fiber` to the nutrition schema, prompt, resolver + bundled table, and display. The vision
  model already returns rich output — this is mostly plumbing + UI.
- **Why it fits:** no new call, no deps. One more number through the existing pipeline.
- **Touches:** `core/schemas` (`Nutrition`), `core/ai/prompt.ts`, `core/nutrition/{resolver,table,format}.ts`,
  D1 `nutrition` table migration (nullable `fiber`), Mini App meal cards/detail, bot reply summary.
- **Risks:** migration must keep existing rows valid (nullable, back-compat like the `age`/`birthDate`
  handling). Micronutrients are deliberately **out of scope** here (would need a nutrient DB = weight).

### R5. Streaks + weekly recap digest — effort S–M, risk low, fit ✅
Retention mechanics the market leans on, nearly free here.

- **Streak:** consecutive logged days = a deterministic `COUNT` over the meals table (reuse the
  local-day-key logic in `weekPrefs.ts`). Show on Home + optionally in the bot reply.
- **Weekly recap:** have the existing 15-min reminders cron send a Sunday "week in review" (avg kcal,
  protein hit-rate, streak, best day). Keep it deterministic; *optionally* let the user's key write a
  one-line AI summary. Make it shareable via the **existing canvas share-card** code.
- **Why it fits:** reuses the cron and the share card; the numbers are already computed for the weekly
  view. No new infra, no deps.
- **Touches:** `apps/worker` cron (`runReminders` neighbor), `core` (streak + recap formatting + tests),
  Mini App Home (streak badge), reuse share-card canvas.
- **Risks:** another opt-in toggle; respect the existing "no spam" reminder discipline (at most one
  recap/week).

---

## Tier 2 — strong, slightly more scope

### R6. Portion confidence + one-tap portion correction — effort M, risk low, fit ✅
Attacks the documented weak point (portion sizing) honestly.

- Surface the model's confidence; on low-confidence meals, offer instant multipliers in the bot
  (`¼ · ½ · 1× · 2×`) that rescale all macros deterministically (no re-call).
- **Touches:** `core/schemas` (confidence already modeled), `webhook.ts` (inline buttons + rescale),
  Mini App meal detail (portion stepper). Rescale math is deterministic.
- **Fit:** reinforces "always an editable estimate"; no AI re-call needed for a portion change.

### R7. Deterministic goal nudge on every log — effort S, risk low, fit ✅✅
When a meal is logged, append one computed line to the confirmation ("that's 96g protein today,
14g to target"). Totals + targets are already computed — this is a string, not a feature.
- **Touches:** `webhook.ts` photo/text reply, `core/telegram/bot.ts` reply builder.

### R8. Group-chat / shared logging — effort L, risk medium, fit ⚠️ (design task)
The item the owner explicitly parked (see `.kiro/PROJECT_CONTEXT.md` §6). A genuine differentiator — no
major competitor does shared household logging, and Telegram is the natural home for it.
- **Real work:** group-scoped meal ownership (doesn't exist today; meals are strictly owner-scoped),
  bot **privacy mode off** in BotFather to receive group photos, and a rethink of the 1:1 assumptions
  in the photo flow (in-place "Analyzing…" edit, per-user rate limit, reply-to-revise).
- **Treat as a design spec, not a patch.** Start with the simple case (each poster's photo logs to
  their own account) before a true shared log.

---

## Tier 3 — flag the cost before building

### R9. Restaurant / menu-item awareness — effort M–L, fit ⚠️
Partly reusable via Open Food Facts for packaged items, but broad restaurant data adds weight. Only
pursue on clear demand; prefer a cheap conditional `fetch` over any bundled dataset.

### R10. Micronutrient tracking (vitamins/minerals) — effort L, fit ⚠️
Cronometer's moat, but it needs a nutrient database = real weight. Defer unless users ask; if built,
do it as a lookup/HTTP path, never a bundled dataset.

---

## Explicitly out of scope (would violate the doctrine)

Carried forward from the original backlog doctrine, still true:
- Depth-sensor / on-device portion scanning (hardware-bound, heavy).
- Client-side barcode/image/ML libraries or WASM blobs (the vision model reads digits — keep it).
- A verified multi-million-food database clone (that's a different, heavy product).
- Server-side AI (defeats BYOK / zero model cost).
- State-management or heavier UI kit (the SWR cache + shadcn-style components are enough).

---

## Suggested build order

1. **R1 Voice + text logging** — closes the biggest market gap, reuses the AI call.
2. **R2 Adaptive targets** — MacroFactor's moat, done as pure deterministic math.
3. **R4 Fiber macro** — quick credibility win through the existing pipeline.
4. **R3 Conversational coach** — on-demand, on the user's key.
5. **R5 Streaks + weekly recap** — retention, reuses the cron + share card.

Each reuses the existing single AI call or deterministic computation, adds no heavy dependency, stays
within the free tier, and preserves BYOK/zero-cost. Build in verified batches per the working norms in
`.kiro/PROJECT_CONTEXT.md` §7 (code → build core → typecheck → test → lint → update docs → commit).

_Last updated: 2026-10 (Visionary session). Update as items are picked up or priorities shift._
