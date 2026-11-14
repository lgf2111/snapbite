# What you can rely on today

Written 2026-11-11, for https://snapbite.leeguanfeng.com. It lists what a normal
person can use now, what still needs Telegram, and what is knowingly unfinished.
Where something was checked against production it says so; where it was only
reasoned about or tested in code, it says that too.

## You can rely on (no Telegram needed)

Open the site in a phone browser, or add it to the Home Screen. Everything below
works for an anonymous visitor.

- **An account appears by itself.** The first visit creates an anonymous account
  tied to a cookie. Because the app now calls `/api/*` on its own origin (a Pages
  Function proxies to the Worker), that cookie is first-party. Checked on
  production: two `/api/me` calls from the page returned the same account.
- **Set your goal.** First-run setup computes calorie and macro targets from a
  short profile. Skipping is fine: Home shows a "Set goal" card, and setup comes
  back on the next launch for an account that has no profile and no targets.
- **Home.** Daily and Weekly views, the calorie ring with an "over" label, macro
  bars, and the day's meals. Pull to refresh, swipe a meal row to delete.
- **Log a meal.**
  - *Manually*, or from *saved meals*: no AI key needed.
  - *From a photo* (camera or library): the AI estimate runs on **your own AI
    key**, added in Settings. Without a key a photo cannot be read.
  - Tap the camera button for the four-card menu, or press, hold and slide for
    the fan. Every estimate is editable before and after saving.
- **Edit a meal**, save it as a favourite, share it as a picture, or delete it.
- **One-tap logging from an iPhone Shortcut.** Create the token in Settings →
  One-tap logging; revoke it there too. It also needs your AI key.
- **Sign in with Google** to keep the account when you clear browser data or move
  phones (see "Unfinished": only test users can today). An account that already
  owns your email wins; otherwise your anonymous account adopts the email, so
  nothing is lost.
- **Your data.** Export it as JSON, or delete the account and everything on it,
  from Settings. AI keys are stored encrypted and device tokens only as hashes.

## Reminders

Meal reminders are web push first: Settings → Meal reminders → **Reminders on this
phone**. They arrive as notifications from SnapBite, not from Telegram.

- **On iPhone** this works only once SnapBite is on the Home Screen (iOS 16.4+). In
  Safari the switch says "Add SnapBite to your Home Screen first".
- **Not guaranteed.** iOS can drop them if the app was force-quit or Low Power Mode
  is on.
- **Each device subscribes separately.** Phone and laptop both get the reminder.
- **Telegram is only the fallback**, for an account that has a Telegram identity but
  no live push subscription (never subscribed, or the subscription turned out dead).
- A subscription the push service reports gone (404/410) is deleted at once; five
  failures in a row also remove it. Delete the account and they go too.
- "Send a test notification" appears once the phone is subscribed.

## Still needs Telegram

These are delivered by the bot, so an account without a Telegram identity does
not get them, even though the settings screens exist in the app.

- **Adaptive calorie-target updates and the weekly recap.** Bot messages, skipped
  for web-only accounts. (Meal reminders no longer need Telegram: see "Reminders"
  below.)
- **Logging by sending the bot a photo or text**, and the commands `/saved`,
  `/weight`, `/coach`, `/setup`, `/export`, `/delete`, `/feedback`.
- **Linking a web account to a bot account.** Send `/linkemail` to the bot; the
  email is the join key. Meals logged in the bot show in the app only after that.
- **`/token`** still mints a Shortcut token for people who have not installed the
  app; the app is the documented path now.
- **The Telegram Mini App** keeps working with Telegram identity, unchanged.

## Knowingly unfinished

- **Web push reminders are built but have not been seen on a real phone.** The
  cipher and the signing are tested against an independent decryptor and a
  signature check, but an actual iPhone notification is unproven. They need the
  migration `0017_push_subscriptions.sql` applied and the three `PUSH_VAPID_*`
  Worker secrets (both done by the owner at deploy), and the Pages deploy for
  `public/sw.js`.
- **Google's consent screen is in Testing.** Only accounts listed as Test users
  can sign in; anyone else is stopped by Google with `access_denied`. That is
  console configuration, not code. Moving the app to production is a separate
  decision in the Google console.
- **The install guide's 14-day dismissal is not an install tracker.** It is a
  timer in `localStorage`. "Installed" can only be observed while running as the
  installed app; the app cannot know if someone installed it earlier and deleted
  it, and clearing site data brings the card back. iOS has no install API, so the
  card only gives instructions there.
- **Anonymous accounts are per browser storage.** Safari and the installed Home
  Screen app keep separate cookies, so they are separate anonymous accounts until
  you sign in. A Google sign-in in Safari lands in Safari, not in the installed
  app.
- **Photo logging depends on your own AI key**, and the Worker has no shared key.

## Build note: production must be same-origin

Until the 2026-11-11 build fix, `pnpm deploy` compiled the Worker's `workers.dev`
address into the bundle and refused to deploy without it. Every API call then went
cross-site, skipped the Pages Function proxy, and on iOS the session cookie was
third-party again (Google's account chooser even named `lgf2111.workers.dev`).
`build:prod` now builds without a Worker URL, and `check:bundle` aborts the deploy
if a `workers.dev` address is in the bundle. A production build with no Worker URL
is the same-origin HTTP backend, not local mode; empty means local mode only in
dev and tests. This takes effect on the next Pages deploy.

## What was checked against production, and what was not

Checked on 2026-11-11, in a real browser at 430×932 and with `curl`:

- `GET /api/auth/start/google` redirects to Google with `redirect_uri` exactly
  `https://snapbite.leeguanfeng.com/api/auth/callback/google`, and sets
  `sb_oauth_state` on the app's origin.
- A callback with no valid state redirects to `https://snapbite.leeguanfeng.com/?auth=state`.
- Tapping "Continue with Google" in the app reaches Google's sign-in page for this
  OAuth client with no `redirect_uri_mismatch`.
- The cookies the Worker sets are `SameSite=None; Secure; HttpOnly` with no
  `Domain`, so the browser files them under the app's own origin.
- The deployed bundle contains the newer screens (setup on the form for a
  signed-in account, the account card states).
- With `/api/auth/me` answered by a stand-in inside the page (nothing written to
  production): setup opens on the form panel with "Signed in as …" and the sign-in
  link hidden; Settings shows the email, "Signed in with Google" and Sign out;
  while the request is pending or failing it shows "Checking your account…" or
  "Try again" and never the sign-in buttons; Sign out returns the card to the
  sign-in state.

**Not checked:** a real Google sign-in. Completing Google's login needs a Test
user's credentials, which this session does not have, so the following are
unproven: that the session cookie from a real callback is sent back on the next
`/api/me` (including on iOS Safari and in the installed app), that a cold start
after the redirect lands on the form, and that Sign out clears a real session.
Also unverified on a real iPhone: opening the file picker when releasing the fan,
haptics (Telegram and Android only), safe-area insets, and keyboard behaviour in
the setup form.
