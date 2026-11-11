# Handoff — credits, supporter tag, analytics

*Written 2026-11-12, while the owner slept. Five stages built, deployed, and the two
things only you can provision are in `docs/HANDOFF-blockers.md`.*

## Shipped and live

- **Worker `17e8cd62`**, **Pages `ba16663f`**, migration `0018_billing.sql` applied to
  production with counts checked before and after (228 meals, 18 users, 18 settings —
  nothing lost).
- 365 worker tests, 463 miniapp tests, typecheck clean, biome 0 errors, CI green on
  `main` (run `43094560876`).

### What exists now

1. **Billing core** — `billing_accounts` keyed by email with **no cascade from `users`**,
   `credit_ledger`, `ai_usage`, `billing_events`, cached `users.plan`.
2. **Credit cascade** — the user's own key is tried first; a real quota wall (429 or
   403 quotaExceeded, never a 5xx) falls back to `GEMINI_API_KEY` and spends one credit,
   with a 20-credit daily overflow cap and one `ai_usage` row per call.
3. **Billing API** — `GET /api/billing/summary`, `POST /api/billing/settings`,
   `POST /api/billing/trial`, `POST /api/billing/checkout` (503 without Stripe),
   `POST /api/billing/webhook` (idempotent, unsigned events are recorded but never
   applied), and `POST /api/admin/topup` behind `x-admin-token`.
4. **Analytics behind the supporter tag** — 90-day and 12-month series, weekly
   adherence, weekday patterns, dish frequency, projection. Free rings, weekly view,
   recap and streak untouched.
5. **Credits UI** — a Credits and supporter card in Settings (balance, trial state,
   three packs with per-credit price, overflow switch), a Reports row on Home, and a
   one-line trace only when a credit is actually spent.

### Verified, not assumed

- `GET /api/billing/summary` returns `{"signedIn":false,…,"credits":0,…,"packs":[…]}`
  and lists Starter 100/$4.99, Regular 300/$11.99, Bulk 1000/$34.99.
- `POST /api/admin/topup` granted **100 credits to lgf2111@gmail.com**, and the ledger
  shows `delta 100, reason topup`.
- `billing_accounts` for that email now has `credits 100, supporter_since set`, so the
  tag is live for your account tomorrow.
- `/api/me` carries `supporter` and `credits` for the client, so nothing infers
  entitlement from key presence any more.

### Ready for you to try

Open Settings → **Credits and supporter**: you should see **Supporter** and **100
credits**. Home should show the Reports row; the three report cards should open.

## What still needs you

`docs/HANDOFF-blockers.md` is the worklist. Short version:

1. **`GEMINI_API_KEY`** — a SnapBite-owned AI Studio key. Without it, a user with
   credits gets a typed "hosted analysis isn't configured" refusal instead of an
   analysis; BYOK users are unaffected.
2. **Stripe** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, plus a dashboard
   webhook endpoint at `https://<origin>/api/billing/webhook` for
   `checkout.session.completed`. Until then checkout answers 503 with a clear message.
3. **Decide** whether Google sign-in becomes mandatory for everyone. It is currently
   mandatory only for anything paid or tagged; anonymous accounts still log meals for
   free and still own their data. Making it fully mandatory would break the Shortcut
   token path for anyone not signed in.

## Two things I would test first tomorrow

- Buy flow without Stripe: long-press the credit balance in a dev build with
  `VITE_ADMIN_TOKEN` set, or call the topup endpoint directly (I used the latter).
- Sign in with Google, confirm the tag survives an app close and reopen — that is the
  cold-start path that has bitten us twice.
