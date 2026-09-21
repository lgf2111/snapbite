# SnapBite product & engineering principles

## Core vision: stay lightweight

SnapBite's guiding principle is to be **as lightweight and low-resource as possible** — small
bundles, minimal dependencies, and cheap runtime cost. Every feature is weighed against this.
When there's a choice between a heavier "do it ourselves" approach and a lighter one that reuses
what we already have, prefer the lighter one.

### Practical rules

- **Avoid heavy dependencies.** No large libraries, WASM blobs, or image/media processing bundles
  in the Worker or Mini App unless there is truly no lighter option and the user has agreed to the
  cost. (Example: barcode reading is done by having the vision model read the printed digits, NOT by
  bundling a JPEG decoder + a WASM barcode reader.)
- **Reuse the existing AI call.** We already send the meal photo to a vision model. Prefer extracting
  more from that single call (labels, barcode digits, multiple foods) over adding new processing steps.
- **Prefer a cheap HTTP call over bundled compute.** A small conditional `fetch` to a free API
  (e.g. Open Food Facts) is lighter than shipping a library to compute the same thing locally.
- **Do work only when needed.** Guard optional lookups/enrichment behind a condition (only call
  Open Food Facts when a barcode is present; only run the reminder loop for users who enabled it).
- **Keep background/recurring cost minimal.** Scheduled work (the reminders cron) must query only the
  rows it needs and stay comfortably within Cloudflare's free tier.
- **BYOK, no server-side AI cost.** Nutrition/AI runs on the user's own key; we never take on
  per-request model cost ourselves.
- **Everything is an estimate, always editable.** Nutrition values are shown as estimates and remain
  user-correctable.

### When a feature would add weight

Flag the cost to the user before adding it, offer the lightest alternative, and default to NOT adding
heavy dependencies. If a heavier approach is genuinely required, get explicit agreement first.
