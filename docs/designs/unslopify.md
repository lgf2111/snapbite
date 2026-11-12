# Unslopify SnapBite

* **Author:** Jeff Lee
* **Date:** 2026-11-13
* **Status:** Review corrections folded in

## Overview

SnapBite's UI has accumulated the visual habits of AI-generated front ends: emoji standing in for icons, a radius applied to everything, and copy that explains itself. The unslopify audit is not a restyle — it removes those tells and then makes one deliberate choice per tell, in a project that already has a palette (logo blue), a type scale, and a product voice (terse, food-first).

Baseline from the scanners, before any change:

- UI scan (`devibe_scan.py apps/miniapp/src`): **20 `rounded-everything`, 12 `emoji-as-icons`**, no high-severity hits.
- Code scan (`apps/worker/src`): 48 `boilerplate-marker`, 47 `emoji-in-code`, 46 `verbose-naming`, 4 `narrating-comment` — **most of these are false positives for this project** (see Rejected).

Final state: **zero emoji in shipped JSX strings** and **zero radius utilities outside the role set**. The external scanner reports 12 medium `rounded-everything` findings and no high-severity findings: the capture button, two avatars, the status dot, the switch thumb, four capsule bar/track rules, and three CSS slider-track radii. Every one is on the circle/capsule list this brief deliberately allows. The scanner is no longer vendored or used as the gate, because it cannot distinguish those shapes from decoration.

## The tells that are real, and the choice that replaces each

### 1. Emoji as in-app icons (12 occurrences, six distinct glyphs) — delete them, do not swap them

`MacroLine` used 🔥 🥩 🍚 🧈 as its legend and inline values; `MealDetailScreen` and `ManualMealDialog` used the same set; `HelpAccordion` used 💡; the Home streak reused 🔥. The icon-per-noun pattern is the tell, and `MacroLegend` is the proof: an icon set that needs its own legend is not doing the work of a label.

- **`MacroLine` renders text.** The full line is `1,900 kcal · P 150g · C 200g · F 60g`; fiber appears only when `fiberG` is non-null, as `Fiber 8g`. The compact list row is kcal only: `500 kcal`.
- **`MealTotals`** keeps its four values and visible macro names, with no icon cell above them.
- **`MealDetailScreen` and `ManualMealDialog`** show visible labels (`Calories`, `Protein`, `Carbs`, `Fat`) beside their inputs.
- **`MacroLegend` and `MACRO_LEGEND` are deleted**, along with every comment describing macro emoji the code no longer has.
- **The streak flame is dropped.** The pill keeps the number and its `aria-label`; it does not become a second flame next to the kcal ring.
- **`HelpAccordion` keeps one Lucide `Lightbulb`** as a section marker. It is not a data-type icon and the visible "Need help?" label already names the section.

**Accessibility correction.** The first draft claimed the icons were decoration because a label sat next to them. That was false: `MacroLine` rendered only glyph, number, and unit, so the glyphs were load-bearing for sighted users. Replacing them with words fixes both the icon tell and the missing label; it is not an argument for prettier glyphs.

### 2. Rounded everything (20 hits) — three corner decisions, one flush exception

The app mixed `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl` and `rounded-full` by feel. The final system is:

- `--radius-control` (10px): inputs, buttons, segmented items, text chips, inset cards.
- `--radius-surface` (16px): cards, sheets, dialogs, popovers, the share card.
- `--radius-flush` (0): a surface that sits directly on the page. Used **once**, on the Home ring/verdict card, which loses its border, background, radius, and padding.

`rounded-full` is a shape, not a fourth step. It survives only on genuinely round or capsule things:

- the capture button, the progress ring, avatars, and status dots;
- capsule bars and tracks — the 3px macro bar, the 2px report bars, and the slider tracks.

Chart bars are deliberately square (`rounded-none`), not a 2px compromise. Text chips use `control`. Nothing uses an arbitrary radius value, including the switch thumb, which is `rounded-full` rather than `rounded-[50%]`.

The flush card is the one change that buys more hierarchy than the scale itself: before it, every module on Home was the same bordered box.

### 3. Copy that explains itself

One pass over in-app strings, with these rules:

- A label names the thing; a sentence stays only when the user must decide something or cannot find a control.
- Delete a sentence whose removal leaves the screen usable and the action obvious.
- No ungrounded adjectives. "Effortless", "seamless", "powerful", "smart" appear nowhere in the app.
- Keep the bot's voice exactly as it is (see Rejected).

**Keep, because they are load-bearing:**

- "Tap the camera to add one." — the only pointer to a control outside the component. The duplicate in the no-goal card is merged into one `CAMERA_CUE` constant used by both branches.
- The reminders footnote: times snap to the nearest 15 minutes.
- The free-tier sentence: free keys stop at about 20 requests a day, with the fix (add billing or set a fallback).
- "Today or yesterday keeps the run alive — logging in the evening never breaks it."
- The irreversible-delete warning.

**Delete or rewrite:**

- Reports row: delete "Trend · Adherence · Report card". The row is "Reports" and a chevron.
- "Set a goal to see your rings" → "Set a goal to see today's progress" (there is one ring).
- "Meals are logged either way." → "Set a goal later — meals log without one."
- Delete the revived-days bookkeeping clause; keep the revival cadence ("once every 30 days").
- Delete the repeated fallback paragraph; keep only "OpenAI (gpt-4o-mini) is recommended."
- Keep the feedback sentence in the dialog, not on the card above it.
- Delete "You can export everything or delete your account at any time below" — the buttons say it.
- Delete "How the Home 'Weekly' toggle groups your days." — the per-mode descriptions below do it.
- Delete the onboarding "Heads up…" warning; it arrives after the decision.
- Adaptive targets: replace the long estimate paragraph with two facts and a cadence — log weight weekly; the goal may shift once a week and stays editable.
- "encrypted at rest" → "encrypted on our servers".
- "analysed by a mock" → "analyzed by a demo model"; use the American spelling (`analyze`, `analyzed`, `analyzer`) throughout the mini app.
- Home over-target: keep the sr-only "over target"; drop the duplicate `title` attribute.

## CI gate

The old gate ran `devibe_scan.py --severity high`, but the baseline had zero high-severity findings, so it could never fail. It also reported medium findings without enforcing them. That was theatre.

The replacement is a path-based check in the repo:

- **Command:** `pnpm lint:ui` at the root, run as a CI step immediately after `pnpm lint`.
- **Script:** `scripts/check-ui-tells.mjs`, using the repo's pinned `typescript` dev dependency to parse the AST. No network fetch, no unpinned external script, no Python.
- **Paths:** recursively `apps/miniapp/src/**/*.{ts,tsx}`.
- **Emoji:** fail on an emoji codepoint in a JSX text node, a string literal, or a template-literal fragment. Comments are not AST string nodes and are ignored. The match covers `Emoji_Presentation`, `Extended_Pictographic` + VS16, regional indicators, and keycaps.
- **Radius:** fail on any class token beginning `rounded` outside the allowed set. The allowed set is `rounded-full`, `rounded-control`, `rounded-surface`, `rounded-flush`, `rounded-none`, plus directional forms such as `rounded-t-surface` and `rounded-b-none`. Variant prefixes (`sm:`, `after:`) are stripped before the check. The review's set was `{full, control, surface, none}`; `flush` and directional forms are deliberate additions because this brief requires both, and the gate would otherwise fail the code it mandates.
- **Failure message:** `UI tell check failed (N findings):`, then `file:line:column`, the offending glyph/class, and the allowed radii. Exit code 1. A clean run prints `UI tells: clean (N files checked).`

## Migration sequence

The implementation follows four phases. Each phase is independently reviewable; call-site migration is one commit per directory.

1. **Alias.** Add `--radius-control: 10px` and `--radius-surface: 16px`; add a deprecation shim (`xs/sm/md → control`, `lg/xl/2xl+ → surface`). Do not migrate call sites yet.
2. **Migrate.** Sweep call sites directory by directory against an explicit intent table: controls and chips to `control`; cards, sheets, dialogs, and popovers to `surface`. Each directory is its own commit.
3. **Retire.** Delete the shim and the legacy 10/14/20/28 tokens in a CSS-only commit. From this point a stock radius class has no project value and the gate rejects it.
4. **Flush and exceptions.** Add `--radius-flush: 0` and apply it once to the Home ring/verdict card. In the same pass, restore capsule bars/tracks to `rounded-full`, move text chips to `control`, and make chart bars `rounded-none`.

**Known conflict in the review instruction:** phase 1 cannot be both a shim and "zero visual change". Only the 10px steps can alias to `control` without moving; `lg` (20px) and `xl` (28px) cannot alias to `surface` (16px) and stay identical. Phase 1 is therefore a token-only commit, not a no-op commit, and phase 2 accepts the visible 20/28 → 16 change directory by directory. The brief records this rather than claiming a zero-diff commit that does not exist.

## Review findings

Three lenses reviewed the brief and overturned parts of it. These corrections override the original sections:

1. **Emoji → Lucide was a swap, not a fix.** The macro icons and their legend were deleted, and macro values are words (`P 32 · C 41 · F 12`). The streak flame was dropped rather than mapped to a second flame. Six glyphs were in play: the four macro glyphs, 🌾 fiber, and 💡 help; the streak reused 🔥. The help marker remains as one Lucide section marker.
2. **The accessibility claim was false.** `MacroLine` had no visible label, so the glyphs were load-bearing. The fix is words, not more icons.
3. **Radii needed aliasing and sequencing, not a bulk remap.** The final system has `control`, `surface`, and `flush`, with `full` reserved for circles and capsules. The Home verdict card is flush. The phase-1 zero-visual-change claim is corrected above.
4. **The CI gate was theatre.** The high-severity scanner could not fail. It is replaced by `pnpm lint:ui`, which checks emoji and radii directly. The allowed set adds `flush` and directional forms, as noted in the CI section.
5. **The copy pass had cut load-bearing strings.** The camera cue, 15-minute footnote, free-tier sentence with its fix, streak rule, and delete warning are kept. The Reports subtitle, "rings", "Meals are logged either way", fallback/feedback duplication, export narration, weekly header, onboarding warning, and revived-days clause are cut or rewritten.
6. **Jargon and spelling were inconsistent.** "Encrypted at rest" became "encrypted on our servers"; "analysed by a mock" became "analyzed by a demo model"; the mini app uses American `analyze` throughout.

## Goals vs. Non-Goals

**In scope:** the in-app emoji, the radius scale, in-app copy, and a CI gate that enforces the UI rules.

**Out of scope:** the palette (logo blue is the identity), the type scale, layout structure, the Telegram bot's message copy, and component APIs.

## Rejected findings, with reasons

- **`emoji-in-code` (47 hits) in `apps/worker`.** Almost all are Telegram message copy — weekly recap, streak revive, feedback alerts. Emoji in a chat message is the platform's own convention and the bot's voice; stripping them would make SnapBite sound cold in the one place it speaks conversationally. The scanner cannot tell a UI icon from a chat string. **Rejected.**
- **`boilerplate-marker` (48 hits).** These are `// Step 1` style comments in tests documenting a command sequence. They aid navigation. **Rejected.**
- **`verbose-naming` (46 hits).** Names like `createPushSubscriptionsDb` are long because the module has three sibling databases; shortening them costs clarity for a metric. **Rejected.**
- **`narrating-comment` (4 hits).** Two are genuinely redundant and were removed in the copy pass; two explain *why* (iOS gesture constraints) and stay.

## Key decisions

1. Macro data is named in words, not icons. One section marker (the help bulb) remains because its visible label already does the naming.
2. Three corner decisions — `control`, `surface`, `flush` — plus `full` as a shape for circles and capsule bars/tracks. No stock steps and no arbitrary values.
3. The CI gate is path-based and checks the shipped mini-app source directly; the bot's emoji copy is outside its path and out of scope.
4. No new colours, fonts, or shadows in this pass. Removing tells is not permission for a restyle.
