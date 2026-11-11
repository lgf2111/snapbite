# SnapBite Freemium Model

* **Author:** Jeff Lee
* **Date:** 2026-11-12
* **Status:** Reviewed — seven-lens Goldfish pass complete, recommendations adopted

## Overview

SnapBite is free today because every AI call is paid for by the user's own provider key. The owner wants a freemium model: free with your own key, paid without one. That premise survived review; the *justification* did not.

The product is one thing: **the AI that reads a photo**. Everything else — the log, the rings, the streak, saved meals, the history — is the user's own data, and gating it would mean building a deliberately worse product to manufacture a paywall. So the paid tier sells one capability at launch, **we hold the key**, and its recurring value comes from a second axis that costs storage and a query rather than tokens: the compounding record that makes logging faster over time.

A second correction: **free is not the cost-free tier, and premium is not the easy tier.** Free carries the hardest setup in the product (a Google Cloud project and a key), and premium's first promise is the removal of that chore. That inversion is legitimate only if it is deliberate and stated, and only if a free user can still log a first meal without a key.

## Analysis

### The boundary moved

The draft put history and "priority processing" behind the line. Both were rejected.

- **History cannot be gated.** It has no retention window or date floor today (`db/meals.ts` applies only `.limit()`), so there is nothing to gate — a limit is a *removal*. Four lenses reached this independently. The log, date navigation, export and streak stay free, permanently.
- **Priority processing does not exist to sell.** Analysis runs inline in the request handler (`routes/meals.ts`); there is no queue, job table or status endpoint. Promising it means a second, permanently divergent analysis path for the weakest user-visible benefit. Cut.
- **Health-platform import cannot ship on a PWA.** HealthKit and Health Connect need native entitlements. Re-scoped to a *file* import (Apple Health export XML, Google Fit takeout) — server-side parsing, which is genuinely premium-shaped and shippable.

### What premium actually is

**Premium = a hosted credential on our side of the provider factory.** The seam already exists: one provider factory parameterised per request, one branch that fails when a user key is missing. Premium writes a key we own instead of decrypting theirs.

Because that is a one-time relief, not a recurring benefit, premium needs a second reason to renew, and the cheapest durable one is **the record**: permanent photo history, the 12-month view, "what changed this month", portion drift, and a one-tap **"your usual"** tile derived from the last 30 days. All computed from rows already stored, at zero AI cost.

The strongest idea from the review is a **dish index**: resolve an exact or near-name match against the accumulated food table first, calling the model only on a miss. Each new user is subsidised by history instead of billed against it. Deliberately not in scope for launch — see Deferred.

### The entitlement model the draft got wrong

`users` is one row per *credential*, not per person: a human holds a device row, a Telegram row and a Google row. The Google callback mints a fresh device account when the cookie is absent. A `plan` column on `users` grants premium to exactly one sign-in path, and a payer loses it by switching device — the same failure that stranded this owner's meals twice.

Adopted:

- `billing_accounts` keyed by verified email or provider customer id — source of truth, with **no cascade from `users`**, so deleting an account cannot erase payment history while the subscription keeps charging.
- `users.plan` as a **cache** only, so the reminder cron filters in one query.
- `plan`, `plan_source`, `current_period_end`, `grace_until` — effective plan computed from *time*, never from webhook arrival. A dropped webhook must not downgrade a payer; a missed cancellation must not grant forever.
- AI source resolved once per request by `resolveProviderForUser(db, env, userId)` returning `byok | included | none`. Eight hand-written "decrypt key, build provider" pairs across five files collapse into it. Two of those files mount *outside* the auth middleware, so entitlement must be a pure function of `userId`, not middleware state.
- `/api/me` returns `plan` and `effectivePlan`; settings returns the tri-state AI source. The client stops inferring entitlement from key presence — today a healthy keyless premium account renders as broken.

### Downgrade

Today's free path hard-fails without a key (`Add your AI key in Settings first`). A premium user who never stored a key would lose all AI the day the subscription lapses — a bricked account, and a refund.

Adopted: grace window, then a **usable floor** — manual entry, full log, date navigation, export and the record keep working; photo analysis stops and offers the existing key help inline. Nothing is deleted; paid-era photos stay readable; only new analysis stops.

### Cost arithmetic that changed the design

- AI is **$0.06–$1.66 per user-month** at 123 calls, a 27× band because `aiModel` is nullable and the provider picks a default. Premium must **pin the model in code**.
- Output tokens are ~81% of a call at 2.5 Flash, and `AIFoodAnalysis` has `.min(1)` with no `.max()`, so a 20-item photo scales linearly. Cap foods (~12) and set max output tokens before launch.
- Gemini tier pricing **doubles on 1 Jan 2027**; price the tier at 2027 rates and date the review.
- The photo pipeline is asymmetric: the Shortcut shrinks to 400 KB, while `POST /api/meals` stores the miniapp's original base64 with **no size check or shrink** — ~12× the storage, filling R2's free tier at 22 users. Share `shrinkImage` there and reject bodies over ~10 MB before decode.
- No retention policy: photos accrue forever and free users' photos would be subsidised by premium. State a window instead of discovering it on an invoice.
- No rate limit on the Shortcut token: one scripted token can burn the entire monthly project budget at 2,000 calls/day. D1-backed limit (20 calls/day, 3/min) checked *before* key decryption, plus a WAF rule on `/api/shortcut/log`.
- Nothing meters anything today, so the promised fair-use cap can be neither enforced nor measured.

### Observability, because money now depends on it

- `ai_usage` per call: `userId, provider, model, tokensIn, tokensOut, costMicros, latencyMs, ok, requestId`. One table answers spend, provider error rate, p95 latency and top spenders.
- `error_logs` gains `userId`, `plan`, `provider`, `model` — today a failure is attributable only to a Telegram id, which is null for exactly the accounts premium serves.
- `billing_events(event_id PK, type, received_at, applied_at, payload_hash)`, plus a daily count of unapplied events.
- Map provider 402/403/429 to distinct kinds instead of a single 502; alert on `quota_exceeded`, not aggregate error rate.
- `scheduled_runs` row per cron tick — a total push outage currently looks like a quiet zero.
- `GET /api/admin/health` returning the counters, plus a daily digest through the existing bot client.

## Goals vs. Non-Goals

**In scope**

- Free: every current feature, unlimited, BYOK (Gemini or any supported provider), plus a no-key path to a first meal so the product is not gated behind a Cloud project.
- Premium: hosted AI (no key), permanent photo history, the 12-month record and derived reports, the "your usual" tile, file-based health import, multi-collection saved meals.
- `billing_accounts` + cached `plan` + period/grace model; one `resolveProviderForUser`; `/api/me` publishes the plan.
- Metering, rate limiting, model pinning, photo-size parity, retention policy, observability set.
- Downgrade with a usable floor and no data loss.

**Out of scope**

- Payment provider choice and integration, tax, pricing currency (shape only).
- Native mobile apps; HealthKit/Health Connect.
- Dish index / pooled nutrition resolution (stage 2).
- Marketing copy, launch plan, tier naming.

## Alternatives we weighed

1. **Everything free, donations.** No cost pressure today, no path to funding server-side AI. Rejected by the author.
2. **Metered credits, pay per photo.** Forces a decision at every meal — the opposite of a one-tap logger. Rejected by the author.
3. **Premium = cosmetics.** Nothing in it justifies a subscription. Rejected.
4. **Free capped at N photos/month on our key.** Rejected in the draft; the review salvaged the shape with a different unit — cap **novel dishes**, not photos, since repeats, favourites and manual entries cost no AI. Deferred: needs dish normalisation, and a bad matcher either gives away tokens or blocks a legitimate new dish.
5. **Kill the tiers; host the key and charge nothing.** The contrarian lens argued the free tier is just the product, every premium feature was a new subsystem rather than a gate, and the smallest shippable version is "a hosted key in settings, set by hand". Its structural advice is adopted wholesale; its conclusion (do not build a business) is rejected by the owner's decision.
6. **Gate history and priority processing.** Rejected: one is a removal, the other does not exist.

## Decisions adopted

1. Premium sells **one capability at launch**: AI without a key. Feature gating is limited to those with real marginal cost or real depth (permanent history, reports, collections, file import).
2. **Never gate the user's own data**, the log, date navigation, export, or the streak. Streak revive stays free — charging at the moment a user feels bad converts a loyalty loop into a paywall prompt.
3. Entitlement lives in `billing_accounts`, cached on `users.plan`, computed from time with grace.
4. One `resolveProviderForUser`; no route file mentions a plan.
5. Additive migration only: `plan` with `NOT NULL DEFAULT 'free'`, because two insert paths never mention it and a nullable column breaks every anonymous signup at deploy.
6. Metering, rate limits, model pinning, photo-size parity and observability ship **with** the paid tier, not after.
7. No priority queue, no history limits, no health-platform integration.
8. Anonymous accounts can still log meals; upgrading requires a verified identity, and sign-in must **claim the existing anonymous account and its meals** rather than mint an empty one.

## Open questions for the next pass

- Which no-key path gives a free user their first meal: on-device estimate, food search, or a small pooled allowance? The UX review treats this as a blocker on the free tier's credibility.
- Launch price and the exact fair-use number, once the model is pinned and 2027 pricing is known.
- Whether the "your usual" tile is premium-only at launch or free-with-limits, given it is the strongest retention mechanic found.

## Appendix: findings rejected or deferred, with reasons

- **"Free tier should not exist / do not build a business."** Rejected: contradicts the owner's decision. Its substance (no feature gates, no metering beyond usage, hosted key as the only paid capability) is adopted.
- **"Cap free at 15 novel-dish analyses/month."** Deferred on merit, not rejected: needs dish normalisation and a confidence floor before it can ship without blocking legitimate meals.
- **"90-day photo retention on free, permanent on premium."** Deferred: adds a retention cron and a "photo expired" state. Until then, if storage bites, downsample rather than delete.
- **Evidence correction:** the draft cited `db/streak.ts`; no such file exists. Streak is a pure function in `packages/core`, and the revive button lives in the Telegram webhook callback (30-day cooldown, 7-day grace) — another enforcement point outside `accountAuth`.
- **Evidence correction:** the draft said "your own Gemini key". The app supports OpenAI, DeepSeek and custom endpoints plus a fallback provider; the free tier is broader than claimed.
- **Evidence correction:** "costs nothing to run per user" is false. Storage, Worker CPU and D1 writes put free at well under one cent per user-month at launch scale, but not zero.
