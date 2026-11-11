# iOS Shortcut capture (MVP)

One press on the Action Button → camera → photo logged. No app, no share sheet,
no Telegram.

## What exists

* `POST /api/shortcut/log` — bearer device token instead of `initData`. Accepts
  either `multipart/form-data` with a `photo` file, or JSON
  `{ base64, mimeType, hint? }`. Analyses with the user's BYOK key, saves the meal
  and answers in plain text, two lines (`17 kcal — Want Want milk candy` then
  `P 0 g · C 3 g · F 0 g`).
* `/token` in the bot — mints a device token (private chat only) and `/token revoke`
  kills every token on the account. Tokens are stored as SHA-256 hashes; the raw
  value is shown once.
* Migration `0012_device_tokens.sql`.

## Deploy

```bash
cd apps/worker
npx wrangler login                                  # once
npx wrangler d1 migrations apply snapbite-db --remote
npx wrangler deploy
```

## Build the Shortcut

1. Shortcuts → **+** → name it `Log Meal`.
2. **Take Photo** (camera: Back).
3. **Convert Image** → JPEG, quality 0.6. Skipping this sends HEIC, which the
   endpoint rejects with a message telling you to add this step.
4. **Get Contents of URL**
   * URL: `https://snapbite-worker.lgf2111.workers.dev/api/shortcut/log`
   * Method: `POST`
   * Request Body: **Form**
     * `photo` → type **File** → value **Photo**
   * Headers: `Authorization` = `Bearer sb_…` (from `/token`)
5. **Show Notification** with the contents of the URL request.
6. Settings → Action Button → Shortcut → `Log Meal`.

## Photo storage

Photos captured this way are written to R2 (`snapbite-photos`) at
`photos/<mealId>`, and the meal row gets `photo_key` + `photo_mime`. The photo
proxy (`GET /api/meal-photo/:id`) serves R2 first and falls back to Telegram's
`file_id`, so bot meals logged before storage existed still render, and new bot
meals are archived to R2 as well. Account deletion purges the objects.

## Limits of this MVP

* Any holder of the token can log meals to that account until it is revoked.
* No retry/queue: a provider 5xx surfaces as `Analysis failed: …` in the notification.
* No idempotency key, so a manual re-run logs a second meal.
