# SnapBite — Features

A Telegram-native, AI-assisted food & nutrition logging app (formerly FoodLog). Nutrition is always
shown as an **estimate** and is always **editable**.

## Logging meals

- **Snap a photo to the bot** — send a meal photo to the Telegram bot and it's analyzed and logged
  automatically: foods, portions, and per-food nutrition (calories + protein/carbs/fat).
- **One message that transforms** — the "📸 Analyzing your meal…" message is edited in place into
  the "✅ Logged" result, so the chat stays one message per meal instead of a growing thread.
- **Add a meal by hand** — in the Mini App, log a meal manually (name + macros) with no photo and no
  AI key required.
- **Photo kept for free** — the meal photo is retained via its Telegram `file_id` and shown back only
  to you (image bytes are never stored on our side).

## Smarter photo analysis

- **Nutrition label reading** — if the photo shows a nutrition-facts label, the exact values are read
  off it and used instead of an estimate.
- **Barcode lookup** — if a product barcode's digits are readable, they're looked up in
  [Open Food Facts](https://world.openfoodfacts.org/) and the product's exact per-100g nutrition
  (scaled to the serving) replaces the estimate.
- **Visual estimate fallback** — otherwise nutrition is estimated from appearance.
- **Source-tagged nutrition** — every value is labeled by where it came from (`table`,
  `ai_estimate`, `manual`, `mixed`), and per-food macros are stored so multi-food meals keep each
  food's breakdown.

## Editing & correcting

- **Reply to change a meal** — reply to a logged meal (or just send a message right after) with a
  plain-language change like "add a coke" or "the rice was double"; the bot re-runs the AI, updates
  the meal, and edits the confirmation in place. If you replied, it sends an "✅ Updated" reply to the
  meal.
- **Disambiguation** — if you logged several meals in the last few minutes, the bot asks you to reply
  to the specific one you want to change.
- **Full edit in the Mini App** — review, edit, and correct any logged meal; "Update with AI" lets
  you revise from a plain-language instruction with a review-before-save step.

## Goals & targets

- **Personalized daily targets** — set your profile and goal to get daily calorie and macro targets,
  computed deterministically (no AI).
- **Set up by chat** — send `/setup` to the bot and answer a few questions (sex, age, height, weight,
  activity, goal) to get your targets without opening the Mini App. `/cancel` stops anytime.
- **Home day view** — pick any day on a calendar and see that day's totals against your targets as
  progress rings, plus every meal logged that day (swipe to delete, tap to edit).

## Meal reminders (opt-in)

- **Per-meal toggles** — breakfast, lunch, and dinner each have their own on/off switch and time.
- **Any time, your timezone** — reminders fire in your local timezone; edits are batched behind a
  "Save changes" button.
- **Timezone self-heal** — if your device's timezone changes (travel/DST), it's silently refreshed
  next time you open the app so reminders stay correct.
- **No spam** — you're nudged at most once per meal slot per day.

## AI providers (bring your own key)

- **Provider choice** — Gemini, OpenAI, DeepSeek, or a custom OpenAI-compatible endpoint; pick the
  model too.
- **Automatic fallback** — configure a fallback provider that's used automatically if your primary
  hits a rate limit, overload, or billing problem while logging a photo.
- **BYOK, ~$0 to run** — analysis runs on your own API key; your key is encrypted at rest and never
  shown again or logged.

## Privacy & your data

- **Export** — download everything you've logged as JSON at any time.
- **Delete** — permanently delete your account and all associated data.
- **Owner-scoped** — your meals, photos, and settings are only ever accessible to you.

## Feedback & support

- **Send feedback** — report a problem or share an idea via `/feedback` in the bot or the "Send
  feedback" dialog in Mini App Settings; it goes straight to the maintainer.

## Beta update notifications

- **Versioned changelogs** — as a beta user you get update notifications when new versions ship,
  framed as beta with frequent updates.
- **Quiet updates** — if your previous update message is still recent, it's edited in place to the
  newest version rather than sending you a new message.
