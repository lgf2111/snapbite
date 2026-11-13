# UI plan — SnapBite mini app — 2026-11-13

* **Planner:** Claude Fable 5.2 (pass 2; supersedes the Fable 5.1 draft) · **Executor:** project coding model · **Repo:** `apps/miniapp`
* **Scope:** the React + shadcn + Tailwind v4 PWA (Telegram Mini App and iOS home-screen app). Flows are fixed: capture → analyze → confirm → save, one-tap logging (saved meals, the hold-and-slide fan), Reports.
* **Baseline, measured today:** `devibe_scan.py apps/miniapp/src` → 12 medium findings, 0 high, score 24, verdict "STRONG AI-default look". All 12 are `rounded-full` / `border-radius: 999px`.
* **Supersedes:** `docs/designs/unslopify.md` §2 where it keeps capsule bars, capsule slider tracks and round avatars. This plan makes them square or control-radius (§2.2). Everything else in that brief stands.

## 1. Direction

SnapBite is a meal log for people who log by camera: photograph, confirm the estimate, read the day back. It is used one-handed on a phone, and the numbers are the content. Each screen therefore states one answer in words and one number ("On track", "Over by 180 kcal", "4 of 7 days on target"), puts the evidence under it, and puts the list under that. The interface is neutral; the logo blue is the only accent and appears on the primary action, the current location, links and measured amounts. Content sits directly on the page and is grouped by hairlines and space; only things that float over the page (dialogs, the sheet, the capture menu, toasts, the calendar) are boxes. Controls use the system sans. The system serif (New York on iOS, Georgia elsewhere, no webfont) is used for the large numerals and the verdict line only.

It is deliberately **not a wellness app and not a dashboard**: no green, no coaching or celebration copy, no badges, no grid of equal bordered cards.

### 1.1 House position this plan follows (`design-taste-frontend`)

The skill is written for marketing pages. Its page-composition rules (one section per screen, hero entrance, dealt moments, photographs, hover lifts, the kit and its gate) do not apply to an app and are not used. Its system rules do apply and are binding here:

| House rule (source) | What it fixes in this plan |
|---|---|
| "One strict system per page: one button shape, one radius family, one card recipe, one hairline" (`system.md`) | §2.2, §4.6, §4.10 |
| Radius `round` 10/16/24 "for consumer apps" (`SKILL.md` §4, `system.md` › Radius and buttons) | control 10px, surface 16px are kept |
| "Exactly one filled button marks the main action in any view; every secondary takes one style ... Never a slanted, gradient, ghost or shadowed button, or a third style" | §4.6: `outline` retired, text-labelled `ghost` retired, no button shadow |
| "The interface stays 90 to 95% neutral ... One accent at most" | §2.1 use rules |
| "Sentence case everywhere; labels 13px at 500, never tracked capitals ... Nothing under 13px" | §2.3: all `uppercase tracking-wide` retired; caption is the floor |
| Nav: "opaque ground, a 1px hairline ... no blur, transparency" | §2.5: the bottom bar loses `/95` and `backdrop-blur` |
| Focus: "a 2px ring in the action colour, 2px off the control ... no transition", "3:1 on the ground" | §2.7 |
| Forms: "every field has a `<label for>` above it", "Errors under their fields: checked on submit", "the button stays live until it is pressed" | §3.5, §4.7 |
| "a number never breaks from its unit" | §5 unit rule |
| Copy tell `[copy-em-dash]`; buttons are "a verb plus what the visitor gets" | §5 |
| "no scrim or gradient over a photograph ... or on a solid box" | §3.11 share-card lockup |
| "Never violet or lavender" | the palette has none; nothing may add it |

One stated deviation: "A figure never outgrows the h2 or the h1" is not followed on Home and in the capture sheet, where the kcal numeral (44px) is larger than the title (22px). On those two screens the numeral is the answer the screen exists to give.

### 1.2 Review lens (`apple-design`)

The build is reviewed against the five lenses in `apple-design/SKILL.md`. The rules this plan relies on, quoted from the references:

| # | Rule | Where it binds |
|---|---|---|
| A1 | `accessibility.md › Mobility`: default control size on iOS "44x44 pt"; "Consider spacing between controls as important as size." | §6 hit areas; 8px minimum between targets |
| A2 | `accessibility.md › Vision`: text "Up to 17 pts ... 4.5:1", "18 pts ... 3:1"; "Convey information with more than color alone." | §6 contrast; over-target `+` mark; switch thumb position |
| A3 | `accessibility.md › Vision`: custom type "iOS, iPadOS 17 pt default, 11 pt minimum"; "give people the option to enlarge text by at least 200 percent" | §2.3 floor of 13px; §6 200 % check |
| A4 | `accessibility.md › Mobility`: "if you use a swipe gesture to dismiss a view, also make a button available" | swipe-delete has `Delete meal` on the detail screen; toasts have a close button |
| A5 | `accessibility.md › Cognitive`: "Replacing transitions in x-, y-, and z-axes with fades"; "Tightening animation springs to reduce bounce effects" | §2.6 reduced motion |
| A6 | `layout.md › Guides and safe areas`: "Respecting the safe area is essential to make sure system UI and hardware features like the Dynamic Island don't obstruct content and controls." | §6 device checks |
| A7 | `layout.md › Visual hierarchy`: "you might use negative space, container shapes, or separator lines to show which elements are related" | hairline grouping, §4.10 |
| A8 | `layout.md › Adaptability`: "horizontally adjacent views may need to stack vertically to provide more space for text" | §3.2 verdict block wrap rule |
| A9 | `tab-bars.md › Best practices`: "Use a tab bar to support navigation, not to provide actions." | named trade-off: the capture button stays in the bar because the flow is fixed. It is a sibling button, not a tab: no `aria-current`, never styled as selected |
| A10 | `branding.md › Best practices`: "Apply your app's accent color judiciously ... use it intentionally for primary actions or status indicators"; "Resist the temptation to display your logo throughout your app" | §2.1; the `SnapBite` wordmark leaves Home |
| A11 | `branding.md`: "use a custom font for headlines and subheadings while using system fonts for body copy and captions" | serif limited to numerals and the verdict |
| A12 | `motion.md › Providing feedback`: "generally avoid adding motion to UI interactions that occur frequently"; "Make motion optional." | §2.6 |
| A13 | `sheets.md`: "Display only one sheet at a time"; "Include a grabber in a resizable sheet." | §3.4: no grabber, because the sheet does not resize |
| A14 | `toggles.md › Mobile`: "Use the switch toggle style only in a list row." | §3.8 reminders rows |
| A15 | `writing.md › Best practices`: "Avoid using *we* altogether"; "be clear about what someone can do to fix it"; "Provide clear next steps on any blank screens." | §5 |
| A16 | `loading.md › Best practices`: "Show something as soon as possible." | skeletons, cached-first rendering |
| A17 | `SKILL.md › Lens 2`: "light and dark appearance with no app-specific appearance switch" | `prefers-color-scheme` only (kept) |

Named risk from `SKILL.md › Lens 3`: "a broadsheet of hairline rules, zero radius, and dense columns" is listed as a template look. This plan uses hairlines, but controls keep a 10px radius, floating surfaces 16px, layouts are one column with 16px body text, and zero radius is limited to data bars. The reviewer checks that this holds. Whether hairline grouping is right for Settings is taste decision 2 at the end of the hand-off.

Known gaps against the lens, not fixed here: the capture sheet has no swipe-to-dismiss (`sheets.md`: "Support swiping to dismiss a sheet"); the 6 s undo toast is time-boxed (`accessibility.md › Cognitive`); Dynamic Type is not wired (§7).

## 2. Tokens

Everything maps onto `src/index.css`. "Keep" means the value does not change. Nothing outside these tables may be introduced.

### 2.1 Colour roles

| Role | Light | Dark | Maps to | Change |
|---|---|---|---|---|
| page | `#f8fafe` | `#080d16` | `--background` | keep |
| ink | `#0f172a` | `#e9effa` | `--foreground` | keep |
| ink, muted | `#5a6780` | `#9aa8c0` | `--muted-foreground` | keep |
| raised surface | `#edf2fb` | `#111a28` | `--card`, `--popover` | light `--popover` `#ffffff` → `#edf2fb` |
| inset surface | `#eaf0fa` | `#141d2b` | `--muted` | keep |
| tonal surface | `#e3eaf7` | `#182233` | `--secondary`, `--accent` | keep |
| brand fill | `#024cc5` | `#7fa9ff` | `--primary` | keep |
| on brand fill | `#ffffff` | `#06122a` | `--primary-foreground` | keep |
| brand text | `#024cc5` | `#7fa9ff` | `--primary-text`, `--ring` | keep |
| hairline | `#b6c7e3` | `#2c3b55` | `--border` | keep |
| control outline | `#7485a8` | `#5b6d90` | `--input` | **new value** (was = `--border`, 1.64:1) |
| over target ≤ 20 % | `#8a5300` | `#e0a83c` | `--warning` | keep |
| over target > 20 %, delete, errors | `#b3261e` | `#ff8a7a` | `--destructive` | keep |
| on destructive | `#ffffff` | `#2a0e05` | `--destructive-foreground` | keep |
| success | `#1b7a4b` | `#6fc49b` | `--success` | keep; not used on screen |
| scrim | `rgb(15 23 42 / 0.45)` | `rgb(0 0 0 / 0.6)` | `--scrim` | **new**, add to both `:root` blocks |

Use rules (each is checkable by grep or by reading a component):

1. **page** is the ground of every screen. **raised** is only for things that float: dialogs, the sheet, capture-menu cards, the calendar popover, toasts, and the install notice (the one in-flow exception, because it is dismissible).
2. **inset** is the segmented-control track and empty bar tracks. **tonal** is the secondary button, the streak chip, the grade square, skeletons, the thumbnail placeholder and pressed/hover rows.
3. **brand fill** is used for: the one primary button per state, the capture button, the on switch, the selected calendar day, bar fills and the ring arc. No opacity variants (`bg-primary/80` on the weekday bars becomes `bg-primary`).
4. **brand text** is used for: links, the active nav label and icon, the today ring in the calendar, the selected-segment ring. Not for values, not for decorative icons. The grade letter, `Connected`, on-target macro values and capture-menu icons use **ink**.
5. **hairline** is for dividers and the edges of raised surfaces. **control outline** is the border of every editable field (`Input`, `Textarea`, native `select`) and the off switch track. `Input` and `Textarea` gain `border-input`.
6. **warning / destructive** always appear with a number and a `+` or a word. Destructive text is also used for `Not connected`, field errors and load errors.
7. Disabled: `opacity-50` and `pointer-events-none` on the control (60 % on the capture button). A control is disabled only while its own request is running or when its label names the reason (`No changes`). Forms are never disabled for being invalid (§4.7).
8. Hover exists only for fine pointers (Tailwind v4 `hover:` already compiles under `@media (hover: hover)`): filled → `bg-primary/90`, secondary and rows → `bg-accent`. Pressed: §2.6.

### 2.2 Radius by role (set is closed)

| Role | Value | Class | Used on |
|---|---|---|---|
| control | 10px | `rounded-control` | buttons, inputs, selects, segmented track + items + indicator, streak chip, grade square, thumbnails, skeletons, calendar day buttons, switch track, the photo preview inside the sheet, the app icon image in the share card |
| surface | 16px | `rounded-surface` | dialogs, the sheet's top corners (`rounded-t-surface rounded-b-none`), capture-menu cards, popovers, toasts, the install notice, the meal-detail photo, the share card's photo top corners |
| none | 0 | `rounded-none` | every bar and track (macro, adherence, time-of-day, chart bars, `.range` track and progress), the calendar logged mark, list rows, `SwipeableRow`, sections |
| circle | 50 % | `rounded-full` | exactly two elements: the capture button and the switch thumb. Each class line ends with the comment `// unslop-ignore: circle`. The `.range` thumb keeps `border-radius: 50%` in CSS |

Retire: every other `rounded-full`; the three `border-radius: 999px` in `.range` (→ `0`); `after:rounded-full` on the calendar modifier; `rounded-surface` on `SwipeableRow`, the Home Reports row, the no-goal block and Reports `Section`.

### 2.3 Type (five steps; all sizes in rem; Tailwind stock sizes retired)

| Step | Size / line-height / tracking | Face, weight | Token | Used on |
|---|---|---|---|---|
| display | 2.75rem (44px) / 1.02 / −0.02em | serif 400 | `--text-display` keep | ring numeral (with the existing `ringNumeralSizeRem` stepping), capture-sheet kcal, welcome heading |
| numeral | 1.75rem (28px) / 1 / −0.01em | serif 400 | `--text-numeral` **add** (with `--line-height` and `--letter-spacing` companions) | share-card kcal, credits balance, grade letter |
| title | 1.375rem (22px) / 1.2 / −0.01em | sans 600; serif 400 for the two verdict lines | `--text-title` keep | every `h1`, every `DialogTitle`, Home verdict, report-card headline |
| body | 1rem (16px) / 1.45 | sans 400; 500 for section titles, row titles, button labels, stat values | `--text-body` keep | reading text, inputs (always 16px), buttons |
| caption | 0.8125rem (13px) / 1.35 | sans 400; 500 for field labels, group labels, segment labels | `--text-caption` keep | labels, hints, meta, units, axis text, `sm` buttons, toasts' secondary text |

Rules:

- Weights are 400, 500, 600 only. 600 is for titles, the selected segment and the `+` over-target mark. `font-bold` is retired (share-card wordmark → 600).
- `font-display` (serif) appears only on the display and numeral steps and on the two verdict lines. Remove it from Reports `Section` titles, the locked/error/empty `h2`s, `Stat` values and `MealTotals`.
- No `uppercase`, no `tracking-wide` anywhere (11 occurrences today). Group labels, the report-card eyebrow, `Portion drift`, the provider tag and the source badge become caption 500 in sentence case, `--muted-foreground`.
- Every number uses `.tabular`.
- Nothing renders below 13px.

Retire and map (counts from today's tree): `text-xs` (49), `text-sm` (34), `text-[10px]` (7), `text-[11px]` (2), `text-[0.7rem]`, `text-[0.6875rem]` → `text-caption`. `text-base` (4) → `text-body`. `text-lg` on `DialogTitle` → `text-title`; `text-lg`/`text-sm` in `ProgressRing` non-hero and `MealTotals` → `text-body font-medium`. `text-xl` (grade) and `text-[2rem]` (share card) → `text-numeral`. `md:text-sm` on `Input`/`Textarea` is deleted.

### 2.4 Spacing

Steps: 4, 8, 12, 16, 20, 24, 32px (`1, 2, 3, 4, 5, 6, 8`). No arbitrary spacing values except the existing bar and reserve tokens.

| Use | Value |
|---|---|
| page gutter | 16 (`px-4`, keep) |
| between page blocks | 20 (`gap-5`) |
| ruled section | 16 above the content, then the rule: `border-t border-border pt-4`, inside a `gap-4` column |
| inside a section, between items | 12 (`gap-3`) |
| list row padding | 12 vertical, 0 horizontal (rows are flush to the gutter) |
| label to field | 6 (`gap-1.5`, existing) |
| field to its error text | 4 |
| icon/control to label | 8; thumbnail to text 12 |
| between two touch targets | ≥ 8 |
| dialog padding | 20 (`p-5`, keep); `.sheet-safe` keeps its bottom padding |
| action stack | 8 between buttons, 16 above the stack |

`--spacing-bar` (4.5rem) and `--scroll-reserve` keep their definitions; `scroll-reserve.test.ts` stays green.

### 2.5 Elevation (three levels; stock shadows retired)

| Level | Treatment | Used on |
|---|---|---|
| 0 page | no shadow, no border box; hairlines only | all in-flow content |
| 1 chrome | `border-t border-border bg-background`, opaque, no blur | the bottom bar |
| 2 lifted | `bg-card border border-border shadow-lift` | dialogs, the sheet, capture-menu cards, the calendar popover, toasts |

Add `--lift` to both `:root` blocks: light `0 8px 24px -8px rgb(15 23 42 / 0.28)`, dark `0 8px 24px -8px rgb(0 0 0 / 0.6)`. Expose it as `--shadow-lift: var(--lift);` inside `@theme inline` (the names differ on purpose; a self-reference would not resolve).

Retire `shadow`, `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl` everywhere, including the capture button (its separation is `ring-4 ring-background`), the switch thumb, buttons, inputs, `Card` and the segmented indicator. The `.range` thumb's CSS `box-shadow` lines are deleted; its 2px `--primary` border stays. The install notice has no shadow. All overlays (`DialogOverlay`, capture menu, fan) use `bg-[var(--scrim)]` with no `backdrop-blur`.

### 2.6 Motion

Tokens keep: `--dur-fast` 120ms, `--dur-base` 200ms, `--ease-out-quint`, `--ease-spring`. Only transform, opacity and colour animate.

| Interaction | Motion |
|---|---|
| press on any button, row or segment | `active:scale-[0.97]` over 120ms (capture button `0.90`, kept) |
| segmented indicator | translateX, 220ms, `--ease-out-quint` (existing `SLIDE_MS`) |
| centre dialog | fade + `zoom-95`, 200ms |
| sheet | fade + 16px slide from the bottom, 200ms, no zoom |
| capture menu | existing travel, 200ms |
| macro bars | `scaleX` from the left, 500ms; ring `stroke-dashoffset`, 700ms |
| focus outline | no transition |

Reduced motion: the global block in `index.css` stays, every transition above also carries `motion-reduce:transition-none`, the camera glyph swaps without rotating, the menu appears in place, the scroll cue does not drift. `hover:shadow-2xl` on the capture button is deleted.

### 2.7 Focus

One focus treatment for every control: `outline-none` is replaced by `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Fields (`Input`, `Textarea`, `select`, the `.range` thumb) draw it inside: `focus-visible:-outline-offset-2` plus `focus-visible:border-ring`. The old `focus-visible:ring-[3px] ring-ring/50` computes to 2.45:1 (light) and 2.88:1 (dark) on the page and is removed everywhere. The new outline is `--ring` at full strength: 7.07:1 / 8.36:1 on page, 6.58:1 / 7.50:1 on raised.

## 3. Screens and states

Every screen is one column inside `max-w-md`. There is no second breakpoint: `sm:flex-row` on `DialogFooter` is deleted and action stacks are always vertical, primary on top.

Overflow rules that apply everywhere at 375pt:

- Single-line labels in rows (`meal title`, dish names, saved-meal names, account email) use `min-w-0 truncate`.
- Sentences never truncate; they wrap. Any flex child holding text has `min-w-0`.
- Button labels never wrap and never truncate; every label in §5 fits 303px at 16px.
- User-entered tokens with no spaces (emails, URLs) use `break-all` (existing on the signed-in line).
- Numbers never wrap away from their unit: the join is a no-break space or none (§5).

### 3.1 App shell (`AppShell.tsx`)

Purpose: navigation between Home and Settings, and the capture button. Dominant action: capture.

- Regions: `main` (`px-4 pt-5 reserve-bar`), bar (level 1, `h-[var(--spacing-bar)]`), capture button (64px circle, `-top-5`, `ring-4 ring-background`, no shadow).
- Nav buttons: 80×72, icon 20px over a caption label, active `--primary-text`, inactive `--muted-foreground`, `aria-current="page"`.

| State | What shows |
|---|---|
| idle | camera glyph on brand fill |
| menu open | × glyph on `--card` with a hairline border; `aria-expanded="true"` |
| batch running | button `disabled`, 60 % opacity; `output` under it in caption: `Uploading 2 of 4` |
| focus | §2.7 outline outside the `ring-4` |
| reduced motion | glyphs swap, no rotation |

### 3.2 Home (`HomeScreen.tsx`, `DateSelector.tsx`)

Purpose: am I on track on this day? Dominant action: none in content (capture is in the bar); secondary: open a meal.

Layout, top to bottom, blocks 20px apart:

1. **Date row (44px):** `[‹ 44] [h1 date button, flex-1, centred] [› 44]`. The `h1` holds a button showing the label and a 16px chevron-down; it opens the calendar popover. Label: `Today`, `Yesterday`, else `Thu 13 Nov`; in weekly view the range `23 Oct – 29 Oct`. Label width budget at 375pt is 247px; it truncates beyond that. `›` is disabled on today. The `SnapBite` wordmark is removed from Home.
2. **View row (52px):** `[Daily | Weekly segmented, flex-1] [streak chip] [refresh 44]`, 8px apart. The chip shows visible text `5-day streak` (caption 500, tonal, 44px tall); it opens the streak dialog. At 375pt with a three-digit streak the segmented control keeps ≥ 150px.
3. **Install notice** (§3.10) when it applies.
4. **Verdict block** (level 0, `aria-label="Progress"`): `flex flex-wrap gap-4`. Ring 132px on the left; text column `min-w-[11rem] flex-1` so it drops under the ring when text is enlarged. Text column: verdict line (title, serif 400, wraps to two lines at most), optional caption, then three macro rows (§4.4). In weekly view a `sm` segmented `Total | Daily avg` spans the full width under the block.
5. **Reports row:** 56px, `border-y border-border`, `Reports` body 500 on the left, chevron-right 16px muted on the right. No icon chip, no box.
6. **Meals:** visually hidden `h2` `Meals`, then rows with `divide-y divide-border` (§4.11). No gaps between rows, no cards.

Verdict logic (unchanged, stated so it can be tested): no meals → `Nothing logged yet`; kcal over target → `Over by {n} kcal`; protein below 80 % of target and kcal not over → `Protein is short`; otherwise `On track`.

| State | What shows |
|---|---|
| first load, no cache | rows 1–2; verdict block with an empty ring, `0` and no verdict line; three `Skeleton` rows `h-20 rounded-control`, 8px apart, where the list goes |
| cached, revalidating | cached content, no spinner |
| manual refresh | refresh glyph spins 700ms; toast `Refreshed` |
| no goal, no meals | in place of the verdict block: body 500 `Set a goal to see today's progress`, caption `Tap the camera to add one.`, then a primary button `Set goal` (44px, full width) |
| no goal, meals | same block with caption `Set a goal later. Meals log without one.`; the list shows |
| goal, no meals | verdict `Nothing logged yet`, caption `Tap the camera to add one.`, macro rows at 0 |
| goal, meals | verdict per the logic above; over-target adds the ring's overflow arc in `--destructive` |
| weekly | caption under the verdict: `Week total` or `Daily average` (the range is already the `h1`) |
| load error | `role="alert"` caption in `--destructive` where the list starts: the backend message, or `Couldn't load meals. Tap Refresh to try again.` Cached rows stay below it |
| partial: dates failed | no streak chip, no calendar marks; nothing else changes |
| partial: credit notice | one caption `output` line above the list |
| pending delete | row collapses at once; toast `Meal deleted` with action `Undo`, 6 s |
| delete failed | the row returns; toast with the backend message or `Could not delete` |

### 3.3 Capture menu and fan (`CaptureMenu.tsx`, `CaptureFan.tsx`)

Purpose: choose how to add a meal. Dominant action: `Take photo` (bottom-right, nearest the thumb).

- Four level-2 cards in a 2×2 grid above the bar, 12px gap, each ≥ 96px tall (`min-h-24`) and 165px wide at 375pt: icon 24px in ink, title body 500, hint caption muted. Order and strings: `Saved meals / Re-log a favourite`, `Manually log / Type it in`, `Upload image / From your photos`, `Take photo / Use the camera`.

| State | What shows |
|---|---|
| open | scrim `--scrim`; focus moves to the first card |
| highlighted (launched from a shortcut) | that card has `border-primary` and a 2px `--primary` outline |
| close (Back, Escape, scrim tap, × button) | menu closes; focus returns to the capture button |
| fan | behaviour unchanged; scrim `--scrim`; the active petal is brand fill with on-brand glyph, others raised with ink glyph |
| reduced motion | appears in place |

### 3.4 Capture sheet (`CaptureSheet.tsx`)

Purpose: analyze one photo, confirm, save. Dominant action: `Save meal`. It is `DialogContent variant="sheet"` (§4.5) with the 44px close button in every stage except saving. It has no grabber and does not resize.

| Stage | Title | Description | Body | Actions (top to bottom) |
|---|---|---|---|---|
| analyzing | `Reading the photo…` | 16px spinner + `This usually takes a few seconds.` | photo preview (`max-h-56`, `rounded-control`, hairline) | none. Close, Escape and scrim tap cancel and reset |
| review | `Log this meal?` | `Check the estimate, then save it.` | preview; estimate block | primary `Save meal`; link `Discard estimate` |
| saving | `Log this meal?` | same | same | primary `Saving…` disabled; no close button; dismissal is ignored |
| error, estimate kept (save failed) | `Couldn't save that meal` | `Your estimate is kept. Try again, or discard it.` | preview; estimate block; `role="alert"` caption in `--destructive` with the backend message or `Could not save that meal` | primary `Try saving again`; link `Discard estimate` |
| error, no estimate (analyze failed) | `Couldn't read that photo` | `Try another photo, or log it by hand from the menu.` | preview; alert caption with the backend message or `Could not read that photo` | primary `Choose another photo`; link `Close` |
| saved | sheet closes | — | — | toast `Logged 455 kcal` |
| batch (2–5 library photos) | no sheet | — | status under the capture button | toasts `3 logged`, `2 logged, 1 failed`, `3 failed`; when more than 5 were picked, first: `Only the first 5 of 7 photos were added. Pick the rest again afterwards.` |

Estimate block: `border-t border-border pt-4`, no box. Kcal in display serif with a caption `kcal` after a no-break space; food names joined by ` · ` in caption muted, `line-clamp-2`, fallback `Meal`; then a three-column `dl` (`Protein`, `Carbs`, `Fat`), labels caption muted, values body 500 as `28g`. The separate `Analysing…` loader line is deleted.

### 3.5 Manual meal dialog (`ManualMealDialog.tsx`)

Fixed header, scrolling body, in-flow footer (keep). Dominant action: `Log meal`.

- Header: `Add a meal` / `Log a meal by hand. No photo or AI key needed.`; 44px close.
- Body: **Saved meals** (only when any exist): each row ≥ 44px: star glyph 16px, name (truncate), `455 kcal` caption, and a separate 44px `Remove {name}` icon button, 8px from the row button. Then `What did you eat?` (44px input, placeholder `e.g. Chicken rice`), then `Calories`, `Protein (g)`, `Carbs (g)`, `Fat (g)`, each a visible label above a 44px input with `inputMode="decimal"`, one column.
- Footer: primary `Log meal`, link `Cancel`.

| State | What shows |
|---|---|
| idle | `Log meal` enabled, whether or not the form is valid |
| invalid on press or Enter | no request. Each failing field gets `aria-invalid="true"`, a 1px `--destructive` border and its error text under it (caption, `--destructive`, linked by `aria-describedby`). Focus moves to the first failing field. Validity rules are the existing `nameValid` / `validKcal` / macro parsing; only the presentation changes |
| field corrected | its error clears on the next change to that field |
| logging | `Logging…` disabled; fields disabled |
| logged | dialog closes; toast `Meal logged` |
| log failed | dialog stays; toast with the backend message or `Could not log meal` |
| saved meal tapped | that row shows a 16px spinner in place of the star; other rows disabled; then as logged |
| remove saved meal | row removed; toast `Removed {name}`; on failure the row returns and toast `Could not remove saved meal` |

### 3.6 Meal detail (`MealDetailScreen.tsx`, `MealTotals.tsx`, `SaveMealDialog.tsx`, `SharePreviewDialog.tsx`, `UpdateWithAi.tsx`)

Purpose: correct the estimate. Dominant action: `Save changes` (the Telegram MainButton when available, otherwise the on-page primary; never both).

Layout: `h1` `Edit meal` + 44px close (`Discard and close`); caption meta `13 Nov 2026, 9:21 AM · analyzed by Gemini`; photo (`rounded-surface`, hairline, omitted when absent); a two-column row of secondary buttons `Save meal` ↔ `Saved` (star fills) and `Share`; the foods list directly on the page with `divide-y` (the `Card` wrapper is removed); `MealTotals`; then a vertical stack: secondary `Update with AI`, primary `Save changes`, link in `--destructive` `Delete meal`.

Each food: a 44px name input (`aria-label="Food 1 name"`, body 500) and a 44px remove icon button, 8px apart; under them a `grid grid-cols-2 gap-x-3 gap-y-2` of four fields. Each field is a visible caption label above a 44px input, with the unit (`kcal`, `g`) as caption muted text inside the field's right padding. Fields: `Calories`, `Protein`, `Carbs`, `Fat`. A four-digit value fits the 165px cell.

| State | What shows |
|---|---|
| opened from Home | renders at once from the row summary; the fetched detail replaces it without a flash |
| loading, no summary or cache | `h1`, close button, and three `Skeleton` blocks (`h-40`, `h-20`, `h-20`, `rounded-control`). The text `Loading…` is removed |
| load failed, no cache | `role="alert"` caption in `--destructive`: the backend message or `Couldn't load this meal. Close it and open it again.`; close button only |
| food pending removal | row at 50 % opacity, name struck through and disabled, caption `Will be removed when you save.`, 44px restore button (`Keep food 1`) |
| clean | primary reads `No changes`, disabled |
| dirty | primary `Save changes`, enabled |
| saving | `Saving…` disabled; MainButton shows its loader; toast `Meal updated`, or the backend message / `Could not save` |
| close while dirty | dialog `Discard changes?` / `Your unsaved edits will be lost.`; destructive `Discard changes`; secondary `Keep editing` |
| delete | dialog `Delete meal?` / `This can't be undone.`; destructive `Delete meal` (`Deleting…` while busy); secondary `Cancel`; then toast `Meal deleted` or `Could not delete` |
| save as favourite | dialog `Save this meal`, label `Name`, primary `Save meal` (48px, `Saving…`), link `Cancel`; toasts `Saved to your meals`, `Could not save meal`; unsaving: `Removed from saved meals`, `Could not remove saved meal` |
| share | sheet `Share this meal` / `Preview your meal card, then share it.`; the card (§3.11); primary `Share meal` (48px, `Sharing…`), link `Cancel`; toasts `Image saved` (download fallback), `Could not share` |
| Update with AI | dialog (§5 copy); primary `Update meal` (`Updating…`), link `Cancel`; while busy the status line cycles `Reading your meal…` → `Asking the AI…` → `Recalculating nutrition…` → `Almost there…`; toasts `Applied. Review, then save.` / `Could not update` |

### 3.7 Reports (`ReportsScreen.tsx`)

Purpose: the log read across time. Dominant action: none when ready; `See credits and supporter` when locked.

Layout: 44px back button + `h1` `Reports` + caption `Your log, read across time.`; `90 days | 12 months` segmented; then `Section`s (§4.10). No `Card` on this screen.

- **Report card** (first section): caption muted `Report card · last 7 days`; headline in title serif (`4 of 7 days on target` / `No meals logged`); grade square 44px, tonal, letter in numeral serif ink, `aria-label="Grade B"`; three stats (`Logged 5/7`, `Avg kcal 1,840`, `Avg protein 112g`), labels caption muted, values body 500 sans; then the projection line (caption).
- **Trend:** 112px chart, square bars 2px apart, `bg-primary` for periods with meals, `bg-muted` otherwise; `role="img"` with `aria-label` `Daily calorie trend, 62 logged days` (or `Monthly …, 9 logged months`); axis row in caption: first label, `62 logged days`, last label.
- **Adherence:** up to eight rows `grid-cols-[3.5rem_1fr_2.5rem]`: `Oct 6`, 8px square bar on `bg-muted`, `71%` (or `—`); caption `This week: 5 of 7 days logged · 4 protein hits.`
- **Weekday pattern:** seven square bars, labels in caption (13px); caption `Friday runs highest at 2,140 kcal.`
- **Time of day:** rows `grid-cols-[7.5rem_1fr_2rem]`: label, 8px square bar, count.
- **Dishes:** rows `Chicken rice` (truncate) and `14 meals · 22%` (caption, no shrink); then, after a hairline, caption 500 `Portion drift` and rows `White rice` / `+18% · 150 → 177g`.

| State | What shows |
|---|---|
| loading | header and segmented control; three `Skeleton` blocks `h-36`, `h-40`, `h-32`, `rounded-control` |
| locked (401/403) | one section, no icon: `h2` body 500 `Reports are part of the supporter tag`; caption `Buy any credit pack once, or start the trial, and Reports stay unlocked for good. Credits run the AI. The tag does not expire.`; primary `See credits and supporter`; link `Check again after buying a pack`; caption `The daily ring, weekly view, recap and streak stay free.` |
| error | one section, no icon: `h2` `Could not load the report`; caption with the backend message or `Check the connection, then try again.`; secondary `Try again` |
| ready, no meals | report card, then a section: `h2` `Nothing to report yet`; caption `Log a few meals and this page fills in: trends, weekly adherence, weekday patterns, recurring dishes and a projection.` |
| ready, no goal | report card without the grade square, with caption `Set a goal in Settings to score calorie and protein adherence.` |
| ready, fewer than three logged days in two weeks | projection line reads `Log three days in the last two weeks to see a projection.` |
| ready | all sections; `Dishes` is omitted when there are none |

### 3.8 Settings (`SettingsScreen.tsx`, `PushReminders`, `CreditsCard`, `AccountCard`, `ExportData`)

Purpose: goal, reminders, AI key, credits, account, data. Each section has at most one primary button.

Layout: `h1` `Settings`; four group labels as `h2` in caption 500 muted, sentence case: `Today's targets`, `Logging and AI`, `One-tap logging`, `Account and data`. Under each, `Section`s (§4.10) with an `h3` title in body 500 and no header icon. No `Card` on this screen, including inside `CreditsCard` and `AccountCard` (their file names stay).

| Section | Idle | Other states |
|---|---|---|
| Goal and targets | caption summary (for example `Lose weight · female, 31y`), `MacroLine` text, secondary `Edit goal` | unset: primary `Set your goal`. Editing: `ProfileForm` inline with primary `Save goal`. Toasts `Goal updated`, `Could not save profile` |
| Meal reminders | caption `Once per slot, in your device's timezone. Times snap to the nearest 15 minutes.`; three list rows (`Breakfast`, `Lunch`, `Dinner`), each a label, a 44px time input and a switch; primary `Save changes` appears only when a row differs from the saved value | push status caption, one of the six existing strings (§5); test-send toasts; `Reminders saved`, `Could not save reminders` |
| Adaptive targets | list row: title + switch; caption (two facts, existing); `Log weight (kg)` label above a 44px input with secondary `Log weight` beside it; caption `Last logged: 72.4 kg` | toasts `Adaptive targets on` / `off`, `Weight logged`; field error under the input `Enter a weight in kg (25–400).` (replaces the toast) |
| Weekly view | `Week is` segmented `Last 7 days | Calendar week`; caption `Today and the previous 6 days.` or `The calendar week that contains the selected day.`; when calendar: `Week starts on` segmented `Monday | Sunday`, rebuilt on `ToggleGroup` | — |
| AI key | list row `Status`: `Connected` (ink, check glyph) or `Not connected` (`--destructive`); provider picker; `API key` field; captions (§5); primary `Save key` | demo mode: caption only. Fallback sub-section: switch row, fields, secondary `Save fallback`, link `Remove fallback`. Toasts keep |
| One-tap logging | `ShortcutCard` content, restyled to tokens only | — |
| Account | signed in: caption `Signed in with Google` / `Signed in with an email link`, secondary `Sign out`. Anonymous: caption, secondary `Continue with Google`, `Email address` field, secondary `Email me a sign-in link` | checking: caption `Checking your account…`. Error: `Could not check your account right now.` + secondary `Try again`. Notices and errors keep |
| Credits and supporter | balance in numeral serif + caption `credits left`; status caption; supporter row (bordered with a hairline, `rounded-control`); primary `Start free trial` or pack buttons (secondary) `Buy {pack}` | loading: `Skeleton h-10 w-28`. Error: `Could not load credits.` + secondary `Try again`. Toasts (§5) |
| Privacy and your data | three bullets (§5), secondary `Export my data`, then link in `--destructive` `Delete account`, stacked | export states keep; delete dialog `Delete your account?`, destructive `Delete everything`, secondary `Cancel` |
| Feedback and support | secondary `Send feedback` | dialog `Send feedback`, textarea with visible label `Feedback`, counter caption, primary `Send feedback`, link `Cancel`; toasts `Feedback sent. Thank you.` / `Could not send feedback` |
| Help | `HelpAccordion` keeps its one `Lightbulb` marker and `Need help?` in caption 500 sentence case | — |

Screen-level states: settings loading → the group labels render with one `Skeleton h-24` per group; load failure → `role="alert"` caption `Could not load settings. Check the connection and open Settings again.` (replaces `Failed to load settings`).

### 3.9 Onboarding and sign-in (`OnboardingScreen.tsx`, `SignInScreen.tsx`, `SetupLayer.tsx`)

Full-bleed layer over the mounted shell (keep).

- Panel 1: `h1` `Welcome` in display serif (the only display heading in the app), caption `Let's set up your targets.`, link `Skip for now` top-right (44px), the scroll cue button `Scroll down to set your goal` with the drifting arrow (motion-safe only), and the row `Already have an account?` + link `Sign in`.
- Panel 2: 450ms skeleton (keep), then `ProfileForm` with primary `Set my goal` and link `Skip and start logging`.
- Key step: `h1` `Add your AI key`, caption (§5), `Provider` select (44px, `rounded-control`, `border-input`), `API key` password input (44px), `KeyHelp`, primary `Save key and finish` (`Saving…`), link `Skip and track meals by hand`.
- Sign-in: 44px back button (`Back to welcome`), `h1` `Sign in`, caption `Sign in to bring your goals and meals onto this device.`, then the Account section's anonymous form.
- Toasts: `Goal set`, `Could not save`, `AI key saved`, `Could not save key`.

### 3.10 Install notice (`InstallGuide.tsx`)

The only raised surface in page flow: `bg-card border border-border rounded-surface`, no shadow. Row: phone glyph 16px ink, `Install SnapBite on your phone` (caption 500), chevron, and a separate 44px `Dismiss install tip` button. Expanded body: copy in §5. Hidden when installed, in Telegram, on desktop, or for 14 days after dismissal.

### 3.11 Share card (`ShareCard.tsx`)

4:5. Photo fills the top 60 % (`rounded-t-surface`). Wordmark lockup top-left on a solid `bg-background text-foreground rounded-control` box (no translucency, no blur): app icon 20px `rounded-control`, `SnapBite` caption 600. Below: title body 500 (truncate), kcal in numeral serif + caption `kcal`, three macro cells (label caption muted, value body 500 as `28g`), footer caption `Snap a photo · log your meal · SnapBite` (truncate). No-photo state: the top area is `bg-secondary` with the icon 40px `rounded-control` and `SnapBite` in body 600.

### 3.12 Toasts (`ui/sonner.tsx`)

Bottom-centre above the capture button (`TOAST_BOTTOM`, keep). Level 2: `--card` ground, `--foreground` text, hairline, `border-radius: var(--radius-surface)`, `box-shadow: var(--lift)`. Body text; action label in brand text 500. Always-visible close button with a 44px hit area; sideways swipe only (keep). Messages wrap; no clamp. Error toasts differ by wording, not colour.

## 4. Component contracts

### 4.1 `AppShell` / `NavButton`
- Props unchanged.
- Capture button classes: `size-16 rounded-full` (with `// unslop-ignore: circle`), `ring-4 ring-background`, no shadow classes, `active:scale-90`, `disabled:opacity-60 disabled:pointer-events-none`, `touch-none select-none`, §2.7 outline.
- Bar: `bg-background`, no `/95`, no `backdrop-blur`.
- Easy to get wrong: the bar and the shell root must stay free of blur and opacity (the existing `index.test.ts` shell assertion extends to the `nav` class); `--scroll-reserve` is the only clearance source; the batch caption must not overlap the nav labels at 375pt.

### 4.2 `DateSelector` (same file and props, plus `label?: string`)
- `label` overrides the computed day label (Home passes the weekly range).
- Layout: `[‹ icon 44] [h1 > button, flex-1, min-h-11, centred, truncate] [› icon 44]`. The trigger is a plain text button (title sans 600, ink) with a 16px chevron-down; it has no fill at rest and `bg-accent` on hover. The `CalendarDays` icon is removed.
- Calendar: day cell and day button `size-11` (44px); weekday header caption, `w-11`; caption label body 500; logged mark is a 10×2px `--primary` bar, `rounded-none`, centred 4px above the cell's bottom; selected day brand fill; today has a 1px inset `--primary-text` ring and weight 600; `disabled={{ after: today }}`. Suspense fallback `Skeleton h-[22rem] w-[19.25rem] rounded-control`.
- Popover: `max-w-[calc(100vw-2rem)]`, `p-2`, `collisionPadding={16}`. Grid width is 7 × 44 = 308px, 332px with padding, inside the 343px available at 375pt.
- Easy to get wrong: it must be the page's only `h1`; Home deletes its own `h1`. `aria-label`s `Previous day` / `Next day` stay.

### 4.3 `ProgressRing`
- Remove the unused `icon` prop and its `span`. `hero` keeps `font-display text-display` with `ringNumeralSizeRem`. Non-hero text is `text-body font-medium`. Overflow arc keeps `--destructive`. The `filled > 0` guard stays.

### 4.4 `MacroRow` (extracted from the inline `dl` in `HomeScreen`)
- Props: `label: string`, `have: number`, `target: number`, `unit: string`, `tone: 'primary' | 'warning' | 'destructive'`.
- Renders a `div` with `dt` (caption muted), `dd` (caption 500 tabular): the consumed value in ink when `tone="primary"`, in the tone colour otherwise, then ` / 150g` in muted, then when over a 600-weight `+` with sr-only ` over target`. Then an `aria-hidden` 3px bar: track `bg-muted rounded-none` with a 1px `ring-border`, fill `rounded-none origin-left` scaled by `min(have/target, 1)`, coloured by tone.
- Keep `data-slot="macro-value"`, `data-slot="macro-bar"`, `data-slot="macro-fill"`, `data-tone`.

### 4.5 `DialogContent` (`ui/dialog.tsx`)
- Add `variant?: 'center' | 'sheet'` (default `center`). `center`: today's classes with `shadow-lift` in place of `shadow-lg`. `sheet`: `bottom-0 top-auto translate-y-0 max-w-md rounded-t-surface rounded-b-none sheet-safe`, slide `from-bottom-4` / `to-bottom-2`, no zoom. `CaptureSheet` and `SharePreviewDialog` use `sheet` and delete their own copies of those classes.
- Close button: `size-11` (44px), glyph 20px, `top-1 right-1`, `rounded-control`, full opacity in `--muted-foreground`, §2.7 outline (today it has `focus:outline-none` and no visible focus). Header text gets `pr-10` so a long title never runs under it. `hideClose` keeps working.
- `DialogTitle`: `text-title font-semibold`. `DialogDescription`: `text-caption text-muted-foreground`.
- `DialogFooter` and `DialogActions`: always `flex flex-col gap-2`, primary first in the DOM and on top; `flex-col-reverse` and `sm:flex-row` are removed and callers reorder their children.
- Overlay: `bg-[var(--scrim)]`, no blur.
- Easy to get wrong: the footer stays in flow, never sticky; keyboard-inset behaviour is unchanged; one dialog at a time (the discard confirm closes before any other dialog opens).

### 4.6 `Button` (`ui/button.tsx`)

| Variant | Look | Allowed use |
|---|---|---|
| `default` | brand fill, on-brand label | the one primary action per screen state (§6 counts it) |
| `secondary` | `bg-secondary text-secondary-foreground border border-border` | every other boxed action |
| `destructive` | destructive fill | only the confirming button inside a delete or discard dialog |
| `link` | no box; label in `--primary-text` 500; `underline-offset-4`, underlined on hover and focus; `min-h-11 px-3` | the dismissive or tertiary action under a primary (`Cancel`, `Discard estimate`, `Skip…`); with `className="text-destructive"` for `Delete meal`, `Delete account` |
| `ghost` | no box at rest, `bg-accent` on hover | icon-only buttons (`size="icon"`) only |

- `outline` is deleted; its six callers move to `secondary`. The 23 `ghost` callers with a text label move to `link`.
- Sizes: `default` 44px (`h-11 px-5`), `sm` 44px tall with `px-3 text-caption`, `lg` 48px, `icon` 44×44. `touch` and `icon-sm` are deleted; `icon-sm` callers (Home row AI button) use `icon`.
- Base: `text-body font-medium`, `rounded-control`, no shadow, §2.7 outline, `active:scale-[0.97]`, `disabled:opacity-50 disabled:pointer-events-none`. Full width inside dialogs and action stacks.
- Easy to get wrong: a busy button keeps its width (label swaps to `Saving…`, no spinner added).

### 4.7 `Input`, `Textarea`, native `select`
- 44px tall (`h-11`) by default so callers delete their own `h-8` / `h-9` / `h-11`; `text-body` at every width; `border border-input bg-transparent`; no shadow; §2.7 inset focus.
- Placeholder in `--muted-foreground`; a placeholder is never the only label.
- Invalid: `aria-invalid="true"` adds `border-destructive`; the message is a `p` with an `id`, caption `--destructive`, 4px under the field, referenced by `aria-describedby`.
- Disabled: `opacity-50`, `cursor-not-allowed`.
- Native `select` (onboarding, `ProviderPicker`): same classes; long option text truncates inside the control.

### 4.8 `ToggleGroup`
- `default` unchanged in size (root 52px, item 44px). `sm`: root `h-12 p-0.5`, item `min-h-11` (44px).
- Indicator: `bg-background ring-1 ring-primary-text rounded-control`, no shadow. Selected label ink 600; others muted 500. Item focus: §2.7 outline with `outline-offset-[-2px]` so it stays inside the track.
- Labels never wrap; at most three segments in this app.
- The test hook is `data-state="on"`.
- The hand-rolled `Week starts on` control in `SettingsScreen` is replaced by this component.

### 4.9 `Switch`
- Track 44×24 `rounded-control`: on `bg-primary`, off `bg-input`. Thumb 20px `rounded-full` (`// unslop-ignore: circle`), `bg-background`, no shadow. `.hit-slop` keeps the 44px target. §2.7 outline. Disabled `opacity-50`.
- Used only at the trailing edge of a row whose label is the row title; the row's `label` element is bound to the switch `id`.

### 4.10 `Section` (move the local one in `ReportsScreen` to `components/Section.tsx`)
- Props: `title: string`, `hint?: string`, `level?: 2 | 3` (default 2), `children`.
- Renders `<section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">` with a heading in `text-body font-medium` (sans) and the hint in caption muted.
- Used by Reports and Settings. After this change `Card` is imported only by `InstallGuide`; `ui/card.tsx` drops `shadow-sm` and its `text-sm`.

### 4.11 `MealRow` (extracted from `HomeScreen`) and `SwipeableRow`
- Props: `meal`, `isNew`, `onOpen`, `onDelete`, `onAi`.
- Row: `flex items-center gap-3 py-3`, ≥ 80px tall. Thumbnail 56px `rounded-control`. Text button `min-w-0 flex-1 self-stretch text-left`: title body 500 `truncate`; second line caption muted `455 kcal · Gemini` (the provider is plain sentence-case text, omitted when unknown). AI button `ghost` `icon` 44×44, `aria-label="Update with AI"`, 8px from the text button.
- `SwipeableRow`: root loses `rounded-surface` and `mb-2`; resting ground `bg-background` (was `bg-card`); the revealed strip stays `bg-destructive`, clipped to the row. The parent list supplies `divide-y divide-border`.
- Easy to get wrong: the collapse animation relied on `mb-2`; it now collapses height and opacity only. The Delete strip keeps its accessible name and its 76px width.

### 4.12 `MealTotals`
- `Total` caption muted, then the source as a `Badge variant="outline"` (caption 500; the text is whatever `sourceLabel()` from `packages/core` returns, shown as returned with no `uppercase` transform). Four equal `min-w-0` tracks. Values `text-body font-medium tabular` in sans (no serif), units caption muted after the value, labels caption muted in words. `1,240 kcal` fits an 80px track at 375pt.

### 4.13 `Badge`
- Base text `text-caption font-medium`. Only `outline` is used; other variants are left untouched.

### 4.14 `.range` (CSS)
- Track and progress `border-radius: 0`, 6px tall. Thumb 24px circle (`50%`), `--background` fill, 2px `--primary` border, no shadow; pressed `scale(1.12)`. Focus: `outline: 2px solid var(--ring); outline-offset: 2px` on the thumb. `aria-valuetext` carries the human label.

### 4.15 `Skeleton`
- `bg-secondary rounded-control animate-pulse`. Never `rounded-surface`.

## 5. Copy

Rules for every UI string:

- Sentence case everywhere, including segment labels and dialog titles.
- No em dash (U+2014) in any string. The single exception is the standalone no-value mark `—` in stat cells.
- No "we", "us", "our". The product is named: "SnapBite".
- Units: grams are written tight (`150g`); `kcal` and `kg` follow a no-break space (`455 kcal`, `72.4 kg`); percent is tight (`22%`). Thousands use the locale separator (`1,840`).
- Ellipsis is the single character `…`, used only for in-progress labels.
- A fallback error says what failed and what to do next.

Strings are final. "Keep" means unchanged from today's tree.

**Shell.** Nav `Home`, `Settings`. Capture button aria: `Add a meal. Tap for options, or hold and slide to choose.` / `Close add-meal menu`. Status `Uploading 2 of 4`.

**Home.** Date labels `Today`, `Yesterday`, `Thu 13 Nov`; weekly `23 Oct – 29 Oct` (en dash, from `weekRange`). Arrows aria `Previous day`, `Next day`. Segments `Daily`, `Weekly`, `Total`, `Daily avg`. Streak chip `1-day streak`, `5-day streak`. Refresh aria `Refresh`. Verdicts `Nothing logged yet`, `On track`, `Protein is short`, `Over by 180 kcal`. Captions `Tap the camera to add one.`, `Week total`, `Daily average`. No-goal block `Set a goal to see today's progress`, `Set a goal later. Meals log without one.`, button `Set goal`. Macro labels `Protein`, `Carbs`, `Fat`; value `120 / 150g`. Row `Reports`. Hidden heading `Meals`. Row aria `Update with AI`. Error fallback `Couldn't load meals. Tap Refresh to try again.` Toasts `Refreshed`, `Meal deleted` + `Undo`, `Meal updated with AI`, `Could not delete`, `Could not update`. Streak dialog: `Logging streak` / `A day counts when you log at least one meal.` / bullets `Today or yesterday keeps the run alive, so logging in the evening never breaks it.`, `A whole day with no meals ends the streak.`, `Miss a day and your next log within the week can revive it, once every 30 days.` / button `Close`.

**Capture menu.** Group aria `Add a meal, 4 options`; scrim aria `Close add-meal menu`. Cards: `Saved meals` / `Re-log a favourite`; `Manually log` / `Type it in`; `Upload image` / `From your photos`; `Take photo` / `Use the camera`.

**Capture sheet.** All strings in the §3.4 table. Notification `Meal logged` / `Meals logged` with body `3 logged, 1 failed` (keep).

**Manual meal.** `Add a meal`; `Log a meal by hand. No photo or AI key needed.`; `Saved meals`; `What did you eat?`; placeholder `e.g. Chicken rice`; `Calories`; `Protein (g)`; `Carbs (g)`; `Fat (g)`; `Log meal`; `Logging…`; `Cancel`; aria `Remove Chicken rice`. Field errors: name empty `Name the meal.`; calories empty `Enter the calories.`; any numeric field that fails to parse or is negative `Enter a number, 0 or more.` Toasts `Meal logged`, `Removed Chicken rice`, `Could not log meal`, `Could not remove saved meal`.

**Meal detail.** `Edit meal`; aria `Discard and close`; meta from `toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })` + ` · analyzed by Gemini`; `Save meal` / `Saved`; `Share`; aria `Food 1 name`, `Remove food 1`, `Keep food 1`, `Food 1 calories`; labels `Calories`, `Protein`, `Carbs`, `Fat`; `Will be removed when you save.`; `Total`; the source badge text from `sourceLabel()` (unchanged); `Update with AI`; `Save changes` / `No changes` / `Saving…`; `Delete meal`. Dialog and toast strings as in the §3.6 table. Update with AI dialog: title `Update with AI`; description `Describe the change in plain words, for example "add a can of coke", "the rice was double", or "remove the fries". Review the result before saving.`; textarea label `Change` (visible), placeholder `Describe the change…`; buttons `Update meal`, `Updating…`, `Cancel`. Share title for the OS sheet: `My meal, logged with SnapBite`.

**Reports.** `Reports`; `Your log, read across time.`; `90 days`, `12 months`; `Report card · last 7 days`; `No meals logged`; `4 of 7 days on target`; aria `Grade B`; `Logged`, `Avg kcal`, `Avg protein`, `—`; `Set a goal in Settings to score calorie and protein adherence.`; projection lines keep their wording with the unit rule applied: `Log three days in the last two weeks to see a projection.`, `Holding steady: 1,840 kcal/day vs a 1,900 target.`, `Off target: …`, `At 0.4 kg/week of loss, your 5% milestone (68 kg) lands around Jan 9, 2027.`, `On pace, but the rate is too slow to date: -120 kcal/day vs target.`, `Not on pace: …`, `The 5% milestone is 68 kg.`; `Trend` / `Daily kcal · last 90 days` / `Monthly kcal · last 12 months`; `62 logged days` / `9 logged months`; `Adherence` / `Weeks that hit both calorie and protein targets`; `This week: 5 of 7 days logged · 4 protein hits.`; `Weekday pattern` / `Average kcal on days you logged`; `Friday runs highest at 2,140 kcal.`; `Time of day` / `When your meals land`; `Dishes` / `Most logged foods, and how portions moved`; `14 meals · 22%`; `Portion drift`; `+18% · 150 → 177g`. Locked, error and empty strings as in the §3.7 table. Back aria `Back`.

**Settings.** Groups `Today's targets`, `Logging and AI`, `One-tap logging`, `Account and data`. Section titles `Goal and targets`, `Meal reminders`, `Adaptive targets`, `Weekly view`, `AI key`, `Fallback provider`, `Account`, `Credits and supporter`, `Privacy and your data`, `Feedback and support`, `Need help?`. Changed strings:

| Today | Becomes |
|---|---|
| `Your goal & targets`, `Logging & AI`, `Account & data`, `Privacy & your data`, `Feedback & support` | titles above |
| `Save` (AI key) | `Save key` |
| `Log` (weight) | `Log weight` |
| `Remove` (fallback) | `Remove fallback` |
| `Your key is sent over HTTPS, encrypted on our servers, and never shown again or logged.` | `Your key is sent over HTTPS, encrypted on SnapBite's servers, and never shown again or logged.` |
| `Free AI tiers get busy — your provider can hit a rate limit, … without you resending the photo.` | `Free AI tiers get busy. Your provider can hit a rate limit, be overloaded, or run out of credit, and a photo won't log. Add a second provider and SnapBite switches to it when that happens.` |
| placeholder `saved — paste to replace` | `Saved. Paste a new key to replace it.` |
| `We store your logged meals: foods, nutrition, notes, and timestamps.` | `SnapBite stores your logged meals: foods, nutrition, notes, and timestamps.` |
| `Your AI API key is encrypted on our servers and never included in exports or logs.` | `Your AI API key is encrypted on SnapBite's servers and never included in exports or logs.` |
| `Tell us what went wrong or what you'd like improved. This goes straight to the maintainer.` | `Say what went wrong or what should be better. This goes straight to the maintainer.` |
| toast `Thanks — your feedback was sent.` | `Feedback sent. Thank you.` |
| `Failed to load settings` | `Could not load settings. Check the connection and open Settings again.` |
| weight toast `Enter a weight in kg (25–400).` | same words, shown under the field |

Keep verbatim: the reminders caption; the six push-status strings (`Add SnapBite to your Home Screen first, then turn reminders on here.`, `This browser can't show notifications.`, `Off. Turn it on to get a notification at your reminder times.`, `Notifications are blocked for SnapBite. Allow them in your phone's Settings, then come back here.`, `Notifications are allowed, but this phone isn't signed up yet. Turn it on to finish.`, `On for this phone.`); `Send a test notification`; `Sent. It should arrive in a moment.`; `The phone did not accept it. Try turning reminders off and on.`; `Reminders saved`; `Adaptive targets on` / `off`; `Weight logged`; `Last logged: 72.4 kg`; `Week is`, `Last 7 days`, `Calendar week`, `Week starts on`, `Monday`, `Sunday` and both captions; `Status`, `Connected`, `Not connected`, `API key`; `OpenAI (gpt-4o-mini) is recommended.`; the free-tier sentence; `Settings saved`, `Fallback saved`, `Fallback removed`, `Enter a valid https base URL for the custom provider`; the photo-retention bullet; `Export my data` and the export strings; `Delete account`, `Delete your account?`, `Delete everything`; `Send feedback`.

**Credits.** Changed: `Trial started: 20 credits and 14 days of Reports.`; `Your own AI key is connected, so analyses cost nothing.`; `Spent only when SnapBite's key runs an analysis or your key hits its limit.`; `Reports stay unlocked. The tag does not expire.`; `Buy any pack once and Reports stay unlocked for good.`; `Any pack unlocks the supporter tag permanently. Credits are prepaid analyses on SnapBite's key.`; `Dev topup: 100 credits`; `Development only: grants 100 credits through ADMIN_TOKEN.` Keep the rest (`credits left`, `Supporter tag · trial`, `Supporter tag · forever`, `Supporter tag locked`, `Start free trial`, `Starting…`, `Buy {pack}`, `Packs`, `Try again`, the trial sentences, the toggle label).

**Account.** Changed: `Optional. Signing in keeps your meals when you change phone or clear your browser.` Keep the rest.

**Onboarding and sign-in.** `Welcome`; `Let's set up your targets.`; `Skip for now`; `Scroll down to set your goal`; `Already have an account?` + `Sign in`; `Signed in as {email}`; `Enter a few details to get daily calorie and macro targets. They can be changed any time in Settings. Skip, and targets stay hidden until a goal is set.`; `Set my goal`; `Skip and start logging`; `Add your AI key`; `The photo bot uses your own AI key to read meals from photos. Add one now, or skip and track meals by hand. A key can be added any time in Settings.`; `Provider`; `API key`; `Save key and finish`; `Skip and track meals by hand`; `Sign in`; `Sign in to bring your goals and meals onto this device.`; aria `Back to welcome`. `ProfileForm`: `Estimates from your details, not medical advice. Editable in Advanced mode.`; all other labels keep.

**Install notice.** `Install SnapBite on your phone`; aria `Dismiss install tip`; `Installed, the camera opens straight from the icon and SnapBite uses the full screen, including under the notch.`; `These steps are for Safari. Open this page in Safari first.`; step 1 `Tap the Share button at the bottom of Safari: the square with an arrow pointing up.`; step 2 `Scroll down and tap Add to Home Screen, then Add.`; Android button `Install app`; the Android sentence keeps.

**Share card.** `SnapBite`; labels `Protein`, `Carbs`, `Fat`; `kcal`; footer `Snap a photo · log your meal · SnapBite`.

## 6. Acceptance checks

Machine-checkable. Run at 375×812 and 430×932, in light and dark, with `prefers-reduced-motion` on and off.

- [ ] **Contrast pairs.** Computed from the `index.css` hex values with the WCAG formula already in `src/index.test.ts`; the test gains the rows marked new. Minimums: text 4.5:1, control outlines and focus 3:1, hairlines 1.5:1.

  | Pair | Light | Dark | Min |
  |---|---|---|---|
  | foreground / background | 17.08 | 16.85 | 4.5 |
  | foreground / card | 15.89 | 15.13 | 4.5 |
  | foreground / secondary **new** | 14.77 | 13.83 | 4.5 |
  | muted-foreground / background | 5.45 | 8.09 | 4.5 |
  | muted-foreground / card | 5.07 | 7.27 | 4.5 |
  | muted-foreground / muted **new** (segment labels) | 4.98 | 7.04 | 4.5 |
  | muted-foreground / secondary **new** | 4.71 | 6.64 | 4.5 |
  | primary-text / background | 7.07 | 8.36 | 4.5 |
  | primary-text / card | 6.58 | 7.50 | 4.5 |
  | primary-foreground / primary | 7.39 | 8.00 | 4.5 |
  | destructive / background | 6.26 | 8.49 | 4.5 |
  | destructive / card **new** | 5.82 | 7.63 | 4.5 |
  | destructive-foreground / destructive | 6.54 | 7.88 | 4.5 |
  | warning / background | 6.06 | 9.11 | 4.5 |
  | success / background | 5.11 | 9.31 | 4.5 |
  | ring / background **new** (focus) | 7.07 | 8.36 | 3.0 |
  | ring / card **new** | 6.58 | 7.50 | 3.0 |
  | input / background **new** | 3.55 | 3.74 | 3.0 |
  | input / card **new** | 3.30 | 3.36 | 3.0 |
  | primary / background | 7.07 | 8.36 | 2.0 |
  | primary / muted (bar on track) | 6.45 | 7.27 | 1.8 |
  | border / background | 1.64 | 1.73 | 1.5 |
  | border / card | 1.52 | 1.55 | 1.4 |

  The test also asserts `--popover` equals `--card` in both modes.

- [ ] **Hit areas ≥ 44×44** by `getBoundingClientRect` on: both nav buttons; the capture button; both date arrows; the date `h1` button; every segmented item, including `sm`; the streak chip; refresh; the Reports row; each meal row's text button and AI button; every calendar day button and both calendar nav buttons; every `Button` of every size; every dialog close button; the install-notice row button and its dismiss button; every `Input`, `Textarea` and `select`; each meal-detail food name input, macro input, remove and restore button; every saved-meal row and its remove button; each capture-menu card. Reported separately as "visual / target": each switch (24px / 44px via `.hit-slop::after`) and the toast close button (drawn size / 44px via `::after`). No two targets closer than 8px.
- [ ] **No horizontal scroll** (`documentElement.scrollWidth === clientWidth`) at 375 and 430 on: Home (no goal; goal with no meals; full day with `Over by 1,240 kcal`; weekly with a three-digit streak); the calendar popover open; the capture menu; the capture sheet in review with ten food names; the manual dialog with a 60-character saved-meal name and all four field errors showing; meal detail with a 40-character food name and four-digit calories; Reports in each of its six states; Settings with every section and the fallback sub-section open; the share sheet; a toast with a 120-character message.
- [ ] **Enlarged text:** with `html { font-size: 200% }` at 375: no horizontal scroll and no overlapping text on Home, the capture sheet (review) and the manual dialog; the verdict text column sits under the ring.
- [ ] **Focus:** tabbing through Home, the manual dialog and Settings shows the §2.7 outline on every control, including every dialog close button; `grep -rn "ring-ring/50\|focus:outline-none" src` → 0.
- [ ] **Scanner:** `python3 ~/.hermes/skills/creative/unslopify/scripts/devibe_scan.py apps/miniapp/src`: before `24 (12 medium, STRONG AI-default look)` → after `0 (Clean, no tells detected)`, with exactly two `unslop-ignore` lines (capture button, switch thumb). Without those two annotations the result is `4 (2 medium, Mostly clean, minor tells)`. The build report quotes both numbers.
- [ ] **Retired utilities** (in `src`, excluding `*.test.*`): `text-(xs|sm|base|lg|xl|2xl)` and `text-\[` → 0; `\bshadow(-(xs|sm|md|lg|xl|2xl))?\b` as a class → 0 (only `shadow-lift`); `rounded-full` → 2; `999px` → 0; `uppercase` → 0; `tracking-wide` → 0; `font-bold` → 0; `backdrop-blur` → 0; `bg-black/` → 0; `bg-primary/80` → 0; `variant="outline"` on `Button` → 0; `variant="ghost"` only together with `size="icon"`; `size="icon-sm"` and `size="touch"` → 0; `font-display` only in `ProgressRing`, `CaptureSheet` (kcal), `OnboardingScreen` (`Welcome`), `ShareCard` (kcal), `CreditsCard` (balance), `ReportsScreen` (headline, grade) and `HomeScreen` (verdict).
- [ ] **Copy gate:** `scripts/check-ui-tells.mjs` additionally fails on U+2014 inside a JSX text node or string literal unless the string is exactly `—`. `KeyHelp.tsx` and `ShortcutCard.tsx` are excluded from this one rule by path (§7). `grep -rnE "\b(We|we|our|us)\b"` over JSX text in the other components → 0.
- [ ] **One primary per state:** tests count `data-slot="button"` elements with the `default` variant in the content area (the capture button is chrome and not counted): exactly 1 in each capture-sheet stage that has actions, the manual dialog, meal detail when the MainButton is unavailable (0 when it is available), Reports locked, Home with no goal, each Settings section; 0 on Home with a goal and on Reports ready.
- [ ] **Geometry:** the capture button's top is above the bar's top and its bottom is above the bar's bottom at both widths (`scroll-reserve.test.ts` plus a bounding-box check); the last meal row clears the capture button at the end of the scroll; toasts clear it (`toastClearance.test.tsx`).
- [ ] `pnpm lint:ui`, `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. Tests that pin the old header (`SnapBite` `h1`), `Analysing…`, the disabled `Log meal` button, `icon-sm`, card classes, uppercase labels or the old strings are rewritten to this spec first, then made green.

Device-only (iPhone with a Dynamic Island; run once installed from Safari and once inside Telegram iOS):

- [ ] The date row and the Settings `h1` clear the Dynamic Island; the bar clears the home indicator; the sheet's last button sits above the indicator.
- [ ] With the keyboard up in the manual dialog, the save-meal dialog, the feedback dialog and Update with AI: the focused field, its error text and the primary button are all visible.
- [ ] Focusing any input does not zoom the page (16px inputs).
- [ ] Hold-and-slide fan: releasing on `Take photo` opens the camera; on `Upload image` opens the library; a refused open puts the menu back with that card highlighted.
- [ ] Swipe-to-delete on a meal row does not fight the left-edge back swipe; a sideways toast swipe does not trigger the app switcher.
- [ ] Telegram: Back closes menus and dialogs before leaving the screen; the MainButton shows `Save changes` only when dirty and the on-page primary is hidden.
- [ ] Haptics still fire on refresh, delete and save.
- [ ] Switching the OS between light and dark while the app is open updates every surface, with no white calendar popover in light mode and no blur anywhere.
- [ ] Reduce Motion on: the menu appears in place, the segment indicator jumps, ring and bars do not animate, the scroll cue is still.
- [ ] Increase Contrast on: field outlines and the off switch are still visible in both appearances.
- [ ] VoiceOver order on Home: date heading, previous and next day, view segments, streak, refresh, progress (verdict, three macro rows with "over target" where it applies), Reports, Meals heading, each row (title, kcal, `Update with AI`).
- [ ] VoiceOver in the manual dialog announces each field error when focus lands on the field.
- [ ] The share sheet receives `snapbite-meal.jpg` as a JPEG; "Save Image" works; the lockup is legible on a bright photo and on a dark one.

## 7. Out of scope

- The flows and their state machines: capture → analyze → confirm → save, batch upload, the fan, favourites, Reports gating by the Worker, onboarding order, sign-in.
- Colour values other than the three changed in §2.1 (`--popover` light, `--input` both modes) and the two added (`--scrim`, `--lift`). The dark-mode mechanism stays `prefers-color-scheme` only.
- The Telegram bot's copy, the Worker, `packages/core`, the iOS Shortcut, push delivery, and the wording of backend error messages (the UI only supplies fallbacks).
- The body copy of `KeyHelp.tsx` and `ShortcutCard.tsx` (long-form help). They receive the token changes (type steps, radius, buttons, focus) but their sentences, including their em dashes, are not rewritten here.
- Dynamic Type wiring (`font: -apple-system-body`). It would rescale every rem in a layout whose tests assume a 16px root, and needs its own plan. This is a known gap against rule A3.
- Swipe-to-dismiss on the sheet, the 6-second undo window, the arrows' one-day step in weekly view, the 14-day install-notice snooze, `MAX_BATCH`, and the streak rules.
- Any new icon, webfont, illustration, gradient, blur, glass effect or animation not named in §2.
- Desktop layouts beyond `max-w-md` centred on a wide viewport.
- `ui/tabs.tsx` (imported nowhere), `Badge` variants other than `outline`, and pre-existing dead code not on a touched path.
