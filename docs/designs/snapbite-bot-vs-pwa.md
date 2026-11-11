# SnapBite: stay a Telegram bot or become a PWA

* **Author:** Jeff Lee
* **Date:** 2026-11-09

## Overview

SnapBite is a Telegram-native food logger. The bot is the capture surface: you
send a photo or type a meal, an AI call estimates the numbers, and the bot
answers in the same chat with an editable confirmation. The Mini App is the
review surface: a React app that reads the same data to edit, search and look
at charts.

The question is whether to pivot that stack into a PWA. The word "pivot"
overstates the work in one direction and understates it in another. The UI is
already a web app served from Cloudflare Pages, so the screens do not need to
be rebuilt. What is Telegram-specific is everything underneath the screens:
identity, notification delivery, the photo-ingestion path and distribution.
Those four things are the actual decision.

## Evidence found in the repo

* **The Mini App is already a standalone-capable SPA.** `apps/miniapp` is React
  19 + Vite + Tailwind/shadcn, deployed with `wrangler pages deploy` to the
  `snapbite` Pages project. It has a mock mode that runs with no backend.
* **Identity is Telegram-only.** `apps/worker/src/middleware/auth.ts` accepts a
  signed `initData` string (header or query param) and verifies its HMAC against
  `TELEGRAM_BOT_TOKEN`. There is no session, no cookie, no password, no email.
  The photo proxy and the CSV export also carry `initData` in the query string
  because an `<img>` and a native download cannot send headers.
* **Data is keyed by Telegram user id.** Meals, settings, preferences and the
  streak-revival state all hang off `user.id` derived from that signature.
* **Photos are not stored by SnapBite.** Only the Telegram `file_id` is kept;
  image bytes are fetched through the Bot API on demand (`photoRetry.ts`,
  `getFilePath`). There is no R2 bucket in `wrangler.toml` — only D1.
* **The bot is doing real product work, not just relaying.** Webhook parses
  photos and plain text, edits one "Analyzing…" message into the result, offers
  portion-correction buttons, the streak-revive button, `/saved`, `/coach`,
  `/setup`, reminders on a 15-minute cron, and version broadcasts that edit the
  previous message in place.
* **No payments anywhere.** No Stars, no Stripe, no subscription code. The
  "digital goods must be paid in Telegram Stars" rule constrains nothing today.
* **Platform logic is already isolated.** `packages/core` is transport-agnostic
  by design; the README calls that out as the reason a port is cheap. That claim
  holds for the domain logic and does not hold for auth and photo storage.

## Capture requirement (author constraint, 2026-11-09)

The author's stated pain is not install, it is capture: "I just want to snap a photo
and share it." Today that means native camera → share sheet → Telegram → pick the
SnapBite chat → send. The Instagram detour in his description is not actually
required; the chat picker is the friction he is describing.

Consequences that move the decision:

* **A PWA cannot receive an OS share on iOS.** The Web Share Target API is
  Chromium-only; Safari does not implement it, and Android accepts share targets
  only from an installed PWA. A PWA's capture flow is therefore: open the app →
  tap add → camera or library → upload. That is *more* taps than the bot, not fewer.
* **Telegram already is a share-sheet target** because it is a native app. The
  current bot flow works precisely because of that. It is the one platform option
  on the table that already receives a share.
* **One-tap capture needs a native surface**: an iOS Share Extension / Android
  share intent, or a platform shortcut (iOS Shortcuts, Android share automation)
  posting to the existing Worker API. A web app of any kind cannot do it on iOS.
* The earlier "full control of capture" point in this brief is wrong for iOS and
  is struck: a PWA controls the camera *inside* its own page, not the system
  share path that the author actually wants.

So the author's constraint does not argue for the PWA; it argues against it, and
against the bot only by one chat-picker tap. The cheapest way to test the capture
complaint is a shortcut or share extension pointed at the existing analyse
endpoint, not a platform migration.

## What each platform actually gives you

### Staying a Telegram bot + Mini App

Gains:

* No install and no signup. The first meal is one photo, in a chat the user
  already has open.
* Identity is free and trustworthy. `initData` is signed by Telegram; there is
  no password reset, no email deliverability, no session theft surface of your
  own making.
* Notifications are free and reliable. A bot message is a real push on every
  platform, including iOS, with no install, no permission funnel and no service
  worker. Reminders, streak nudges and broadcast updates all ride this.
* Photo ingestion is free. Telegram uploads, stores and serves the image; you
  keep a `file_id` and pay nothing for storage or bandwidth.
* Distribution is a link. No store review, no signing, no release trains.
* Abuse control is bounded: Telegram gives you one identity per account and
  you already rate-limit per user.

Costs:

* Reach is limited to people who use Telegram and will add a bot. There is no
  home-screen icon, so the product is one chat-list scroll away at best.
* No offline use. No web presence, no SEO, no shareable public pages.
* The UI lives inside Telegram's WebView: theming, height, back-button and
  keyboard behaviour are borrowed, and performance on low-end Android is worse
  than Safari/Chrome.
* You inherit Telegram's policy surface: bot token as a single high-value secret,
  Stars rules for any future paid feature, API changes on their schedule.
* Storage inside the Mini App WebView is shared with the Telegram client's
  container. The TENET paper (2025) found replayable session artefacts in a
  majority of the Mini Apps it audited; that is a class-level risk, not a
  SnapBite-specific bug, but it is a reason not to treat that WebView as trusted
  storage.
* Every product change is coupled to a chat idiom. A dashboard, a weekly review
  or an onboarding tour all have to be squeezed into message edits and buttons.

### Moving to a PWA

Gains:

* Own brand, own domain, own home-screen icon, standalone window, real URL that
  can be shared, bookmarked, indexed and opened on desktop.
* Identity you control: email magic link, passkey or OAuth. Users stop needing
  Telegram, which widens the funnel to anyone with a browser.
* Notifications without Telegram: Android gets Web Push from a normal tab; iOS
  gets it from 16.4 onward, but only once the site is added to the Home Screen.
* Offline read of today's log and queued writes via IndexedDB, if you build it.
* No store fees and no Stars rule if you ever charge.
* Full control of capture: `<input type="file" capture>` or `getUserMedia`, your
  own crop UI, your own progress and retry states.
* Later optionality: the same build can be wrapped with Capacitor for stores.

Costs, in order of how likely they are to hurt:

1. **Install friction on iOS is the whole ballgame.** Safari does not fire
   `beforeinstallprompt`, so there is no install button. The user must open the
   Share sheet and pick "Add to Home Screen". Without that step: no push
   notifications, no standalone window, and Safari's 7-day cap on script-writable
   storage applies (WebKit exempts home-screen apps). Retention math changes the
   moment the user is not one tap away.
2. **You must build auth.** Accounts table, sessions (HttpOnly cookie plus CSRF,
   or bearer tokens), magic-link email delivery and its deliverability problems,
   passkey fallback, account linking for existing Telegram users, and a deletion
   path. This is the single largest piece of new code.
3. **You must build and operate push.** VAPID keypair, `push_subscriptions`
   table, service worker, permission UI that only works after install on iOS,
   silent-failure handling (expired subscriptions, 410s), and a fallback when
   push is denied. The bot currently gives this for zero code.
4. **Photos stop being free.** With no Telegram, someone has to store the
   originals: R2 bucket, signed URLs or an authenticated proxy, lifecycle and
   deletion rules, plus a cost line that did not exist. The photo *is* the
   product's input, so this is not optional polish.
5. **You own acquisition.** No bot directory, no chat forwarding as a growth
   loop. A PWA gets installs only from people you send to the URL.
6. **Client-side data becomes your problem.** Schema migrations for IndexedDB,
   cache invalidation, stale service workers serving old bundles, version skew
   between an installed app that has not been opened in three weeks and a Worker
   that has moved on.

### The third option the framing hides

This is not binary. The bot can stay as the capture and notification surface,
and the same Mini App can be published at a real domain as an installable PWA
with a second sign-in path. One backend, two front doors. That costs auth, push
and photo storage — the same three items a full pivot costs — but it does not
take away the free notification channel or the chat-native first meal. The only
thing it adds is a second path to maintain.

## Goals vs. non-goals (provisional)

In scope if the platform changes:

* One identity model that can serve both a PWA session and a Telegram
  `initData` request, with a migration path for existing users.
* A notification channel that does not depend on the user opening Telegram.
* Direct photo capture in the app, with the existing analysis pipeline unchanged.
* A deployable PWA: manifest, service worker, install path, offline read.

Out of scope:

* Native iOS/Android builds and store submission.
* Payments, subscriptions or any monetisation work.
* Social features, sharing feeds, multi-user households.
* Rebuilding the review UI — it already exists.

## Alternatives weighed

* **Status quo, no change.** Zero engineering, keeps free notifications and free
  photo storage. Does not answer "reach people who do not use Telegram".
* **Dual-mode (bot + PWA on one backend).** Highest reach per unit of work, no
  loss of the current channel, but two entry paths to keep consistent and the
  auth work is not avoided.
* **Full pivot, bot retired.** Simplest product story, and it deletes the bot's
  commands, message-edit idioms and webhook tests. It also deletes the free push
  channel, the free photo store and the only distribution loop, before the PWA
  has proven it can retain anyone.
* **Capacitor wrapper around the existing app.** Real home-screen icon, real
  push, store presence — at the cost of signing, review, and a build pipeline.
  Rejected for a first step because it buys reach you do not yet have.
* **Improve the current Mini App onboarding.** Cheapest experiment; does not
  change who can use the product.

## If it becomes a PWA: the full path

Estimates are for one developer who already knows this codebase.

1. **Decide the mode and the metric (half a day).** Pivot or dual-mode, and the
   number that decides success: installs, day-7 logging frequency, or meals per
   active user. Without this, every later trade-off is arbitrary.
2. **Map what is bot-only (1 day).** Enumerate every flow that assumes a chat:
   photo logging, plain-text logging, reply-to-revise, `/saved`, `/coach`,
   `/setup`, reminders, streak-revive, broadcasts, feedback, admin alerts to
   forum topics. Each becomes an app flow, a push message, or a deletion. This
   list is the real scope.
3. **Accounts and sessions (1–2 weeks).** New `accounts` table with a nullable
   `telegram_user_id`; session middleware beside the `initData` middleware;
   every owner-scoped query moves from Telegram id to account id; magic-link
   email (Resend/Postmark) or passkey; account-linking deep link the bot can
   send ("claim your account"); deletion and export updated.
4. **Photo storage (3–5 days).** R2 bucket, upload endpoint, signed read URLs or
   an authenticated proxy, backfill policy for existing `file_id` meals (they
   keep working only while the bot exists, so decide: migrate on read, or accept
   that old photos are Telegram-bound).
5. **Capture in the app (3–5 days).** File input or camera, client-side downscale
   with canvas, upload with retry and progress, optimistic confirmation, and the
   same analysis call the webhook uses. This replaces the bot's best feature and
   is where the PWA will feel worse if it is rushed.
6. **Push (1 week).** VAPID keys, `push_subscriptions` table, service worker,
   permission prompt gated on installed-and-standalone for iOS, reminder cron
   switched from bot messages to Web Push with email fallback, 410/expiry
   cleanup, quiet hours.
7. **PWA plumbing (2–3 days).** Manifest with 192/512/maskable icons, display
   standalone, theme colour, apple-touch-icon, safe-area CSS, `beforeinstallprompt`
   on Android, a hand-written iOS install sheet, app-shell precache plus
   network-first API, offline queue for logs, update prompt on new service worker.
8. **Domain, hosting, headers (1 day).** Custom domain on Cloudflare Pages,
   HSTS, CSP, staging environment, analytics.
9. **Compliance (1–2 days).** Privacy policy that names the new storage and email
   provider, data export (exists) and deletion wired to both, DPA if EU users.
10. **Dual-run rollout (1 week + observation).** Bot keeps working. Measure
    install rate, push opt-in rate, day-7 retention, meals per user. Only after
    those numbers decide whether the bot is retired.
11. **Ongoing costs.** Domain, email provider, R2 storage and egress, possibly
    analytics. Push itself is free. The recurring engineering cost is the second
    auth path and the service-worker update discipline.

## Open risks and questions

* Which platform is losing you users today: people without Telegram, or people
  with Telegram who do not return to the chat? The fix differs and only one of
  them is a PWA.
* Is the goal reach (new users) or retention (keep the ones you have)? A PWA
  helps the first against install friction, and the second only if push opt-in
  works.
* If the bot goes away, is the product still SnapBite, or does it become a
  generic calorie tracker competing on UI?
* Will you accept photo storage cost and privacy duty, or keep Telegram as the
  photo host and run dual-mode indefinitely?

## Recurring costs (PWA-only, minimal stack)

Checked against Cloudflare and Resend pricing pages on 2026-11-09. The stack is the
one already in use, plus object storage and an email sender.

| Item | Free allowance | Cost past it | At 100 users | At 1,000 users |
| --- | --- | --- | --- | --- |
| Domain | already owned (`leeguanfeng.com`) | ~S$18/yr renewal | $0 | $0 |
| Cloudflare Pages | 500 builds/month, unlimited static requests | — | $0 | $0 |
| Workers | 100,000 req/day, 10 ms CPU | $5/mo (10M req included) | $0 | $0 |
| D1 | 5M rows read/day, 100k written/day, 5 GB | $5/mo plan: 25B read, 50M written, 5 GB then $0.75/GB-mo | $0 | $0–5 |
| R2 | 10 GB stored, 1M Class A, 10M Class B, **egress free** | $0.015/GB-mo + $4.50/M writes | $0 | $0.00–0.10 |
| Web Push | none — VAPID is free | — | $0 | $0 |
| Magic-link email | Resend free: 3,000/mo, 100/day | $20/mo | $0 | $0 |
| Analytics | Cloudflare Web Analytics | — | $0 | $0 |
| Error tracking | Sentry free 5k events/mo (optional) | — | $0 | $0 |
| Apple Developer | **not required for a PWA** | $99/yr only for native | $0 | $0 |
| AI | BYOK — user pays | only if you add a trial allowance | $0 | $0 |

Storage is the only line that compounds, so the number depends entirely on what is
kept. Three meals a day:

* **Thumbnail only (~40 KB):** 3.6 MB/user/month. 1,000 users ≈ 3.6 GB/month of growth,
  so the free 10 GB lasts about three months, then about $0.65/month after a year.
* **Compressed original (~160 KB):** 14 MB/user/month. 1,000 users ≈ 0.17 GB/year each,
  roughly 14 GB/year — about $0.06/month after the first year.
* **Full phone original (~2 MB):** 180 MB/user/month. 100 users alone would exceed the
  free 10 GB inside two months. Do not keep originals.

So a minimal deployment is **$0/month up to roughly 1,000 active users**, crossing into
a single $5/month Workers Paid plan at that point (which also lifts the D1 limits), plus
pennies for R2. The first free limit reached is D1 rows written, not requests.

Recurring costs that are time rather than money, and cannot be avoided by any pricing
choice:

* Service-worker update discipline — an installed app you cannot force-update.
* Push subscription cleanup — expired endpoints return 410 forever until deleted.
* Install support on iOS — Share → Add to Home Screen is a support conversation.
* Photo deletion and export now include object storage, not just D1 rows.
* Alerting: the bot is currently the admin pager. Retiring it means replacing that path
  before the cutover, not after.

## Key decisions so far

* **Platform: full pivot to PWA.** The author accepts Share → Add to Home Screen as the
  iOS install path and accepts losing the Telegram channel. No dual-mode.
* **Consequence accepted:** capture becomes open-app → camera, not hardware button. The
  Action Button flow described by the author cannot be served by any web app on iOS; it
  survives only as an iOS Shortcut posting to the same Worker, and can be kept alongside
  the PWA at no infrastructure cost.
* **Cost envelope:** $0/month target; one $5/month Workers Paid plan when D1 write limits
  are reached. Originals are not stored; a compressed copy is. Magic-link email stays
  inside the Resend free tier, or is replaced by passkeys to remove the dependency.
* Auth is one session middleware beside the existing `initData` verifier; `users` stays
  the account table (UUID key) and `telegram_user_id` becomes nullable.
* Push and offline are later slices, not part of the first cutover.

## Analysis

Pending multi-lens Goldfish review (YAGNI, cost/quota, UX, migration,
observability, tech debt, inventive catalyst). This section gets filled with the
deduplicated findings, including any part of the above that the review
overturns.
