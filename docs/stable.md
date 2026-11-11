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

## Still needs Telegram

These are delivered by the bot, so an account without a Telegram identity does
not get them, even though the settings screens exist in the app.

- **Meal reminders.** Configured in Settings, sent as bot messages. Accounts with
  no Telegram identity are skipped by the reminder job.
- **Adaptive calorie-target updates and the weekly recap.** Also bot messages,
  and also skipped for web-only accounts.
- **Logging by sending the bot a photo or text**, and the commands `/saved`,
  `/weight`, `/coach`, `/setup`, `/export`, `/delete`, `/feedback`.
- **Linking a web account to a bot account.** Send `/linkemail` to the bot; the
  email is the join key. Meals logged in the bot show in the app only after that.
- **`/token`** still mints a Shortcut token for people who have not installed the
  app; the app is the documented path now.
- **The Telegram Mini App** keeps working with Telegram identity, unchanged.

## Knowingly unfinished

- **Web push reminders do not exist.** Reminders are Telegram-only (above). A
  web-only user gets none.
- **Magic-link email is not configured in production.** There is no email
  provider, so the email sign-in option is hidden (`/api/auth/providers` reports
  `email: false`). Until it is set up, Google is the only way to sign in.
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
  you sign in. A magic link opened from an email lands in Safari, not in the
  installed app.
- **Photo logging depends on your own AI key**, and the Worker has no shared key.

## Security note: magic-link login (fixed in code, needs a Worker deploy)

Until this fix is deployed, the production Worker's `POST /api/auth/login`
answers with the sign-in link itself whenever no email provider is configured,
which is production's current state. That link signs in as whatever address was
typed, including an address that already owns a Google account. The fix returns
the link only when `DEV_LOGIN_LINKS=1` is set (local development and tests) and
otherwise answers `{ ok: true, delivered: false }`. It takes effect when the
Worker is next deployed. Nothing on production was tested against this hole.

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
