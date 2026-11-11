# Handoff blockers

Things only the owner can provision. Code is shipped behind env checks and
degrades with a readable message until these exist; the free BYOK path works
without any of them.

## 1. Hosted Gemini key (`GEMINI_API_KEY`)

- **What:** a Google AI Studio API key owned by SnapBite (not a user key).
- **Why:** paid/trial analyses run on our key. Without it, an account with
  credits still gets a typed "hosted analysis isn't configured" refusal instead
  of an analysis; BYOK users are unaffected.
- **Provision:** `cd apps/worker && pnpm wrangler secret put GEMINI_API_KEY`.
- **Model:** pinned in code to `gemini-3.6-flash` (`src/billing/provider.ts`);
  changing the model is a code change, not a secret.
- **Status:** not available in this workspace. Stage 2 shipped and tested with a
  mock provider factory.

## 2. Stripe secrets (Stage 3)

- **What:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- **Why:** `POST /api/billing/checkout` creates a Checkout Session; the webhook
  verifies Stripe's signature before granting credits. Without the secret key
  checkout answers **503** with a clear message; without the webhook secret the
  endpoint still records events but cannot verify signatures, so it must not be
  treated as production-ready.
- **Provision:**
  - `pnpm wrangler secret put STRIPE_SECRET_KEY`
  - `pnpm wrangler secret put STRIPE_WEBHOOK_SECRET`
- **Stripe dashboard:** add a webhook endpoint at
  `https://<worker-origin>/api/billing/webhook` for
  `checkout.session.completed`, then copy its signing secret into
  `STRIPE_WEBHOOK_SECRET`.
- **Prices:** pack amounts live in a server-side constant (Starter 100 / $4.99,
  Regular 300 / $11.99, Bulk 1000 / $34.99). No Stripe Price IDs are needed;
  Checkout uses inline `price_data`.
- **Status:** not available in this workspace. Stage 3 ships with the env gate
  and a tested 503 path.

## 3. Migration application

- **What:** `apps/worker/migrations/0018_billing.sql`.
- **Why:** adds `billing_accounts`, `credit_ledger`, `ai_usage`,
  `billing_events` and `users.plan`.
- **Apply:** `cd apps/worker && pnpm wrangler d1 migrations apply snapbite-db`
  (owner runs this; this workspace never deploys or applies remote migrations).
- **Note:** the Drizzle journal is stale at 0011, but the Worker applies every
  SQL file via `readD1Migrations`; tests already run 0018.

## 4. Admin topup token (`ADMIN_TOKEN`)

- **What:** already an existing worker secret (used by `/api/admin/broadcast`).
- **Why:** Stage 3's `POST /api/admin/topup` uses the same token to test credits
  end-to-end without Stripe.
- **Status:** no action unless it was never provisioned; the route answers 503
  when unset.
