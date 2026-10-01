# SnapBite — Features

A Telegram-native, AI-assisted food & nutrition logging app (formerly FoodLog). Nutrition is always
shown as an **estimate** and is always **editable**.

## Logging meals

- **Snap a photo to the bot** — send a meal photo to the Telegram bot and it's analyzed and logged
  automatically: foods, portions, and per-food nutrition (calories + protein/carbs/fat).
- **Log by text** — no photo handy? Just describe the meal (e.g. "two eggs, sourdough toast, half an
  avocado") and it's analyzed and logged the same way. Start with **`log …`** (or `ate …`/`had …`) to
  force a new meal, or just send a description when you have no recent meal. (Replying to a logged
  meal still edits that meal — see below.)
- **One message that transforms** — the "📸 Analyzing your meal…" message is edited in place into
  the "✅ Logged" result, so the chat stays one message per meal instead of a growing thread.
- **Goal-progress nudge** — if you've set a goal, each logged meal adds one line showing where you
  are for the day (e.g. "📊 96g protein today — 54g to your goal", or a 💪 when you've hit it).
  Computed from your logged meals + targets, no AI; users without a profile just don't see it.
- **Logging streak** — log on consecutive days and each confirmation shows your run (e.g. "🔥 5-day
  logging streak"), with a 🎉 milestone every 7 days. Counting is forgiving: a streak that ran
  through yesterday is still alive until the day ends, so logging in the evening never "breaks" it.
  Pure date math from your logged days, no AI; it only appears once you're at 2+ days.
- **Add a meal by hand** — in the Mini App, log a meal manually (name + macros) with no photo and no
  AI key required.
- **Save meals to reuse** — from a meal's detail view, tap the **star** to save it as a reusable
  favorite (name it when you save; the star stays filled while it's saved, tap again to remove). In
  **Add meal**, your saved meals appear at the top — tap one to fill the form, tweak anything, then
  log. Saved meals sync with your account.
- **Instant loading** — the app caches your meals, saved meals, and settings and shows them
  immediately, refreshing in the background and only updating when something actually changed, so
  reopening and navigating back feel instant.
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
- **Dietary fiber** — beyond the big-3 macros, fiber (🌾) is estimated per food and totaled when the
  analysis can produce it; it shows on the meal's detail and in the bot reply. Unknown stays unknown
  (never a misleading 0).

## Editing & correcting

- **Reply to change a meal** — reply to a logged meal (or just send a message right after) with a
  plain-language change like "add a coke" or "the rice was double"; the bot re-runs the AI, updates
  the meal, and edits the confirmation in place. If you replied, it sends an "✅ Updated" reply to the
  meal.
- **Disambiguation** — if you logged several meals in the last few minutes, the bot asks you to reply
  to the specific one you want to change.
- **Full edit in the Mini App** — review, edit, and correct any logged meal; "Update with AI" lets
  you revise from a plain-language instruction with a review-before-save step.
- **Share or save a meal card** — from a meal's detail view, generate a shareable image (the photo
  plus its name, calories, and macros) to post to Instagram/socials via the native share sheet, or
  save it to your device. The card is drawn on a canvas in-app (no extra libraries), so it stays
  lightweight.

## Goals & targets

- **Personalized daily targets** — set your profile and goal to get daily calorie and macro targets,
  computed deterministically (no AI).
- **Adaptive targets (opt-in)** — log your weight now and then (send `/weight 72.5`, just message
  "72.5 kg", or use the weight field + toggle in Mini App → Settings), and once a week SnapBite
  measures your *real* daily burn from your logged intake vs. your smoothed weight trend and gently
  nudges your calorie goal toward it. All deterministic math (no AI, no server cost); it's an estimate
  you can always override, and your fixed Mifflin-St Jeor target stays the default until you turn
  adaptive on.
- **Set up by chat** — send `/setup` to the bot and answer a few questions (sex, date of birth,
  height, weight, activity, goal) to get your targets without opening the Mini App. `/cancel` stops
  anytime.
- **Edit, don't retype** — if you already have a profile saved, `/setup` shows your current value at
  each step and you can reply `keep` to leave it as-is, so you only change what you want.
- **Age stays current** — you give your date of birth (not a fixed age), so your age — and the
  targets derived from it — update automatically as birthdays pass. Older profiles that stored a
  plain age keep working unchanged.
- **Daily or weekly totals** — the Home screen toggles between a single day and a whole week. In
  Settings you choose what "week" means: the rolling last 7 days, or the calendar week (starting
  Monday or Sunday). Weekly compares your totals against your target × 7.
- **Home day view** — pick any day on a calendar and see that day's totals against your targets as
  progress rings, plus every meal logged that day (swipe to delete, tap to edit).
- **Weekly recap (opt-in)** — turn on the recap and once a week — on your local Sunday — the bot
  sends a short message summarizing the week you logged: days logged, average calories and protein,
  how many days you hit your protein target, your best day, and your current streak. All computed
  deterministically from your own logged meals (no AI, no server cost), sent at most once per week.

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

- **Ask the coach** — send `/coach <question>` (e.g. "/coach am I low on protein today?") and the bot
  answers from *your* logged data — today's and this week's totals vs. your targets — in a sentence or
  two, on your own AI key. On-demand only (no background chatter), and it stays anchored to your
  nutrition rather than being a general chatbot.
- **Send feedback** — report a problem or share an idea via `/feedback` in the bot or the "Send
  feedback" dialog in Mini App Settings; it goes straight to the maintainer.

## Beta update notifications

- **Versioned changelogs** — as a beta user you get update notifications when new versions ship,
  framed as beta with frequent updates.
- **Quiet updates** — if your previous update message is still recent, it's edited in place to the
  newest version rather than sending you a new message.

## Notes & known limitations

- **Old FoodLog photos don't display.** SnapBite was formerly FoodLog, with a different bot. Meals
  logged through the old bot kept a Telegram `file_id` tied to that retired bot's token, which the
  new `@SnapBiteAI_bot` can't fetch — so those older entries show without their photo. The meal and
  its nutrition data are unaffected; only the image preview is missing. New photos logged through
  SnapBite display normally.
- **Re-log a saved meal from chat.** Star a meal in the app, then send `/saved` to the bot to list
  your saved meals and `/saved <number>` to log one again instantly — no photo or AI call needed.
