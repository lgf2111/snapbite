# SnapBite — Improvement Ideas

A living backlog of potential improvements, grounded in the current codebase. Each item notes
**why**, rough **effort** (S/M/L), and **risk**, and is weighed against the project's guiding
principle: stay lightweight (see `.kiro/steering/lightweight.md`). Nothing here is committed work —
it's a menu to pull from.

Legend: effort **S** ≈ <½ day, **M** ≈ 1–2 days, **L** ≈ multi-day. Priority is a suggestion.

---

## High value

### 1. CI pipeline (typecheck + lint + tests on every push) — effort S, risk low — ✅ DONE (`3e54fcf`)
There's currently no `.github/workflows`. A single GitHub Actions job running
`pnpm i && pnpm typecheck && pnpm lint && pnpm test` on PRs/pushes would catch regressions before
deploy. We've already been running these locally every change; automating it is cheap and prevents
a broken `main`.
- Optional follow-on: a separate deploy job (Pages + Worker) gated on green tests, so releases are
  one click and always tested. Keep secrets in GH Actions secrets.

### 2. Reduce the frequent AI schema failures further — effort S–M, risk low — ✅ DONE (`e7418b4`): one repair-retry + Zod issues captured into `detail`
We added a coercion layer (`openai-compatible.ts`) that fixed most "Model output did not match the
expected schema" cases. Remaining ideas if it still recurs:
- **One repair retry**: on a `parse` failure, re-send the same image once with a terse "return ONLY
  valid JSON matching this shape" system nudge before giving up. Cheap (reuses the existing call),
  no new deps.
- **Log the Zod issue summary to D1** (not just the stack) so `/errors` shows exactly which field
  fails — we improved the message but the `detail` column still stores the stack. Capture
  `error.issues` into `detail`.

### 3. Admin alerting is a black box → add a self-test — effort S, risk low — ✅ DONE (`9dce314`): admin-only `/ping`
`adminNotify` now falls back to DM + logs failures, but there's no way to confirm the group/topic
wiring works without triggering a real error. Add an admin-only `/ping` (or `/testalert`) bot
command that sends a sample alert through `adminNotify('error', …)`, so you can verify delivery on
demand.

### 4. Component tests for the Mini App — effort M, risk low — ✅ DONE (`5abac6a`): HomeScreen + useCachedData tests
All current tests are on lib/logic (no `.test.tsx`). The screens have had several regressions this
cycle (2×2 rings, day-navigation, delete flash, cache races). A few `@testing-library/react` tests
for `HomeScreen` (renders cached meals, day switch, delete animation removes the row) and
`useCachedData` (stale-response guard) would lock in the exact bugs we hand-fixed. The deps are
already installed.

---

## Medium value

### 5. `/setup` (goal onboarding) is Mini-App + bot, but favorites are Mini-App-only — effort M — ✅ DONE (`1f0c321`): `/saved` lists + re-logs
A `/saved` bot command to list and re-log a saved meal from chat would round out the feature for
users who live in the chat. Reuses the existing favorites table + `logManual` path.

### 6. Weekly view: daily-average option — effort S — ✅ DONE (`3a6436f`): Total / Daily avg toggle
Weekly currently shows summed totals vs target×7. Some users think in "avg kcal/day". A small toggle
(sum vs average) in the weekly view, computed client-side from the already-fetched range — no new
requests.

### 7. Meal photo re-use across bots is impossible by design — document it — effort S — ✅ DONE (`2d490a1`): FEATURES.md note
Old-bot photos don't display (Telegram `file_id` is bot-specific). This is expected but undocumented
for users. A tiny "photos from before the move won't show" note isn't worth a feature, but worth a
line in FEATURES/FAQ if users ask.

### 8. Onboarding drop-off / empty states — effort S — ✅ DONE (`a96578b`): clearer first-class skip path
First-run with no profile shows the onboarding gate; consider a "skip for now, log a meal first"
path that's even lighter, since logging works without a profile (targets just won't show).

### 9. Rate-limit / abuse guard on the webhook — effort M, risk medium — ✅ DONE (`7dfe5a7`): 40 photos/rolling-hour per user
BYOK means no server-side model cost, but the Worker still does D1 writes per message. A simple
per-user throttle (e.g. ignore >N photos/min) protects the free tier if a user or bad actor spams.
Weigh against complexity — only add if you see abuse.

---

## Lower value / nice-to-have

### 10. Cold-start bundle: defer the calendar chunk — effort S — ✅ DONE (`2e11113`): already lazy; verified + documented
The `calendar` chunk (react-day-picker, ~21KB gzip) loads with the app. It's only needed when the
date picker opens. Lazy-load it so first paint of Home is lighter. (The landing page is already
split out; this is the next-biggest chunk.)

### 11. `mealsInRange` fetches all meals then filters client-side — effort M — ✅ DONE (`9fa2c19`): server-side `?from=&to=`
Deliberate lightweight tradeoff (1 request vs 7). Fine now, but if a heavy user accumulates thousands
of meals the payload grows. If that happens, add a real `?from=&to=` range param to `GET /api/meals`
and filter server-side. Not worth doing preemptively.

### 12. Test-only exports in the core public barrel — effort S, risk low — ✅ DONE (`f2afce9`): reminders barrel narrowed (DEFAULT_MOCK_ANALYSIS kept — used by the CLI test)
`DEFAULT_MOCK_ANALYSIS`, `parseHhMm`, `localParts`, `REMINDER_MESSAGES` are only consumed by tests but
are exported from `@snapbite/core`'s public index. Cosmetic: narrow the barrel so the public API
reflects real consumers. Zero runtime impact.

### 13. `foodlog.*` localStorage keys — effort S, risk low — ✅ DONE (`dee0095`): one-time migration to `snapbite.*`
`store.ts` still uses `foodlog.meals.v1` / `foodlog.profile.v1` (kept for back-compat with any local
data). Only matters in local/dev mode. If you ever want full brand consistency, add a one-time
migration that copies old keys → `snapbite.*` then reads the new ones. Low priority — it's dev-only.

### 14. Accessibility pass on the Mini App — effort M — ✅ DONE (`be05710`): macro/ring aria labels; Biome a11y clean (full WCAG still needs manual AT testing)
Biome flagged a couple of a11y nits (`noLabelWithoutControl` in `MealDetailScreen`). A light pass
(labels tied to inputs, focus order, aria on icon buttons, color contrast on the macro chips) would
help. Full WCAG validation needs manual assistive-tech testing.

### 15. Error-log retention — effort S — ✅ DONE (`176b638`): cron prunes rows older than 30 days
`error_logs` grows unbounded in D1. A tiny cron step (or a `LIMIT` on inserts / periodic prune of
rows older than N days) keeps it small and within the free tier. Only matters long-term.

---

## Explicitly NOT recommended (would violate the lightweight principle)
- Adding a client-side barcode/image library (vision model reads digits — keep it that way).
- A state-management lib (Redux/Zustand) — the SWR cache + local state is sufficient.
- react-query / SWR package — the hand-rolled `useCachedData` covers the need at a fraction of the weight.
- Server-side AI (defeats BYOK / zero model cost).
- A heavier UI kit — the current shadcn-style hand-rolled components are already minimal.

---

**Status:** all 15 items above (#1–#15) are implemented, verified (full build + typechecks + 329
tests green across core/worker/miniapp/cli, lint clean), and shipped. The "Explicitly NOT
recommended" list below was intentionally left untouched.

_Last reviewed against the codebase after the dead-code/dedupe cleanup (commits `b9e821a`,
`9b9015e`). Update this list as items are done or priorities change._
