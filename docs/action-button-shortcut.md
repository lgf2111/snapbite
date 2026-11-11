# iOS Shortcut: one press, one photo, one log

The Action Button (or Lock Screen / Back Tap / Siri) opens the camera, and the
photo is logged to SnapBite before you put the phone down. No app to open, no
chat to send.

You build this on the phone once. It takes about five minutes.

## Step 0 — get your token (2 minutes, one time)

1. Open the SnapBite app → **Settings** → **One-tap logging**.
2. Tap **Create Shortcut token**.
3. Tap **Copy** and keep the `sb_…` value on your clipboard. It is shown once.

   That token is a password to your meal log: anything holding it can add meals
   to your account. Do not paste it into a group chat. If it leaks, tap
   **Revoke** next to it (or **Revoke all**) in the same card and make a new one.

The app card also shows the URL you need in Step 2, with its own copy button.

**If you have not installed the app:** open **@SnapBiteAI_bot** in Telegram, in a
private chat, and send `/token`. The bot replies with a line starting `sb_…`;
`/token revoke` kills every token. The bot refuses to mint tokens in a group.

## Step 1 — create the Shortcut

1. Open **Shortcuts** → **+** (top right).
2. Tap the name at the top and call it **Log Meal**.

## Step 2 — add the actions, in this order

Add each one with the **search bar** at the bottom of the editor.

**Action 1 — Take Photo**
Search `Take Photo`. Leave it as it is (this uses the rear camera).
Tap the chevron on the action and set **Show Camera Preview** to on, so you can
frame the shot. Off makes it fire instantly, which is faster but often useless.

**Action 2 — Convert Image**
Search `Convert Image`. This is not optional: iPhones save HEIC by default and
the server rejects it.
Tap the chevron and set:
- **Convert Image** → the *Photo* variable (it is usually already filled)
- **to** → `JPEG`
- **Image Quality** → `0.6`

**Action 3 — Get Contents of URL**
Search `Get Contents of URL`. Tap the chevron and set:
- **URL** → `https://snapbite-worker.lgf2111.workers.dev/api/shortcut/log`
- **Method** → `POST`
- **Request Body** → `Form`
- Under *Request Body*, tap **Add new field** → **Text**, rename the key from
  `key` to `photo`, tap the value field and choose **File** (not Text), then
  select the **Converted Image** variable from Action 2.
- Tap **Add new field** → **Header**, key `Authorization`, value
  `Bearer sb_your_token_here` (keep the word `Bearer` and one space).

**Action 4 — Show Notification**
Search `Show Notification`, and set its text to the **Contents of URL** variable
from Action 3. The notification text is exactly the server's reply: SnapBite
answers with one plain sentence, so there is nothing to parse or format. A
successful one reads:

```
Logged 612 kcal — Grilled salmon, rice (P 42 · C 58 · F 21)
```

If something is wrong, the reply says so in the same place, for example
`SnapBite: add your AI key in Settings first`. (Add `?format=json` to the URL
only if you want a structured reply to build your own Shortcut around.)

## Step 3 — put it on the Action Button

1. iPhone **Settings** → **Action Button**.
2. Swipe to **Shortcut**, tap **Choose a Shortcut**, pick **Log Meal**.

Press and hold the Action Button once: the camera opens, you shoot, and the
notification tells you what was logged.

## Share it with someone else

If a shareable template has been published, the app's Settings → One-tap logging
card has an **Add the Shortcut** button once you have created a token. To install
it on your own phone:

1. In the app, open **Settings → One-tap logging** and tap **Create Shortcut
   token**. Tap **Copy**: it is shown once.
2. Tap **Add the Shortcut**. It opens in the Shortcuts app.
3. When Shortcuts asks for your token, **paste your own** and tap **Add Shortcut**.
   That is the only thing you have to do.
4. Set the Action Button to it (Step 3 above), and press once to try it.

The iCloud link carries the **action list only**. Tokens are per account and are
never in the link, so sharing it gives nobody access to your meals; everyone who
installs it pastes their own token at import. If the button is not in the app yet,
no template has been published: follow Steps 1–3 above to build it by hand.

**For whoever publishes the template:** build the Shortcut once as in Step 2, but do
not leave a real token in it. Make the `Authorization` value `Bearer ` followed by a
text action that holds an **Import Question** (Shortcut settings → Setup → Add
Import Question) asking "Paste your SnapBite token". Share it from the Share sheet
→ Copy iCloud Link, check that the header shows the question and no `sb_…` value,
then paste the link into `SHORTCUT_TEMPLATE_URL` in `apps/miniapp/src/lib/shortcut.ts`.

## Optional: lock the screen afterwards

Add **Set Focus** or **Lock Screen** at the end if you want the phone to go back
to sleep straight after. iOS does not allow an unattended app to lock the screen,
so **Lock Screen** asks for one confirmation tap; that is a platform limit, not a
setting.

## When it does not work

- **`Analysis failed: …`** — your AI key is out of quota or wrong. Check
  Settings → AI key in the app, or send `/settings` to the bot.
- **`Invalid image type`** — Action 2 is missing or set to HEIC.
- **`Missing token` / `401`** — the header is wrong. It must be
  `Authorization` with the value `Bearer sb_…`, on its own field, not in the URL.
- **Two meals logged** — you pressed twice. The endpoint has no idempotency key
  yet, so each run is a separate meal; delete the extra one in the app.
