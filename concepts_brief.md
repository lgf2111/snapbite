# SnapBite UI/UX Redesign — food-led, numbers-first, PWA-only

* **Author:** Jeff Lee
* **Date:** 2026-11-11
* **Status:** first slice shipped (tokens, shell, Home, Settings); see the end
* **Supersedes:** `docs/designs/snapbite-bot-vs-pwa.md` (the bot-vs-PWA decision, now settled)

## Overview

SnapBite is a photo meal logger. The Telegram bot does the logging; this client
is what you open to see how the day is going and to fix what the bot got wrong.
It runs as an installed PWA on iPhone.

The redesign gives the app its own palette (light and dark), a visual world drawn
from food rather than from a generic dark dashboard, and one job per screen. Home
answers one question — *am I on track today?* — and logging stays one tap away.
Prose that explains the product leaves the working surfaces for help.

## Evidence from the current build

**Home stacks more controls than a read-first screen can carry.**
`HomeScreen.tsx` (448 lines) renders: a header (title, streak, refresh, "Add
meal"), a Daily/Weekly toggle with a nested Total / Daily-avg control, a date
stepper whose ‹ › sit outside the pill, a card holding four 76px macro rings (or
a "set a goal" card when none exist), and the meal list. The capture button and
its "Eaten" datetime field seen at the top of the screenshot come from
`CaptureButton`, mounted in `App.tsx:205` — not from `HomeScreen`. Either way
three separate controls already add a meal before any new bottom bar exists.

**The primary number cannot express "over target".** `ProgressRing.tsx:37`
clamps the arc with `Math.min(1, consumed / target)`, so 100% and 140% draw the
same ring; only the colour changes (`:50`). The centre shows the remainder, which
goes negative.

**Two visible blocks are prose.** The empty state shows "Optional: set a goal for
daily targets" (four lines) and "No meals this day" (three lines). Some copy is
not decoration, though: `SettingsScreen.tsx:593-599` explains that reminder times
snap to a 15-minute grid and are read in the device timezone — a behaviour a user
will otherwise experience as a bug.

**Settings is 1,020 lines of equally weighted cards.**
`SettingsScreen.tsx` renders ten top-level blocks: account, goal, reminders,
adaptive targets, weekly prefs, connection status, AI provider, fallback keys,
privacy/export/delete, feedback. A two-bucket split regroups them without
removing any.

**There is no light mode, and no switch for one.** `index.css` holds a single dark
palette in `:root`, declares `@custom-variant dark (&:is(.dark *))` and never
defines a `.dark` block or a `prefers-color-scheme` query; there is no
`color-scheme` property and no `--success` / `--warning` token. A PWA on a
light-mode iPhone still renders dark.

**Telegram theming is inert in the PWA — but its markup is not.**
`lib/telegram.ts` early-returns from every theme, button and haptic call when
`isTelegramEnv()` is false (`:57, :77, :138, :192, :260`), so the palette in the
PWA is the hardcoded block above, not "whatever Telegram sends". The residue is
the `var(--tg-theme-x, fallback)` pattern across `CaptureButton.tsx:66`,
`AccountCard.tsx:105-161` and others: outside Telegram every one of those
variables is undefined, so each silently renders its fallback. The unlabeled blue
Google button in the screenshot is one instance of that class of bug.

**Shadcn is used, but both segmented controls are hand-rolled.** `HomeScreen`
imports and uses `Button`, `Card` and `Skeleton`. The bypass is the Daily/Weekly
toggle and the Total/Daily-avg toggle (raw `<button>`, `py-1.5` vs `py-1`), the
raw button wrapping each meal row, and a `Card` overridden to `bg-background`
with an inline grid. The highest-value addition is toggle-group.

**Touch sizes and safe areas miss the iOS bar.** `button.tsx` ships `h-8`/`h-9`/
`h-10`/`size-9` (32–40px, none 44), the bottom bar is `fixed … h-16` with `pb-24`
on the scroll container, and `env(safe-area-inset-*)` appears nowhere in `src`.

**The test suite pins the copy this redesign deletes.** `HomeScreen.test.tsx`
asserts "No meals this day" (`:81`), `/set a goal for daily targets/i` (`:97`),
the streak line, "Daily avg" and the weekly total.

Measured from the two device screenshots: 92% of the Home surface is one colour
`#0C141C`; body text `#98A1AC` on it is 7.09:1 and muted `#738B96` is 5.18:1, so
contrast passes; card borders sit at 2.11:1, effectively invisible; two nearly
identical blues (`#389DF8`, `#55A3F0`) are used as if they were different roles.

## Analysis

**The brief under-sells its own biggest gap: there is no dark-mode mechanism.**
Three lenses landed here independently. `@custom-variant dark` is declared and
nothing applies it; `:root` is dark; no media query and no `color-scheme` exist.
"Follow the OS" therefore means either duplicating the token blocks under
`@media (prefers-color-scheme: dark)` or keeping the class variant and adding a
`matchMedia` bootstrap. That choice precedes every other token decision and is
recorded in Key Decisions.

**A four-to-six-colour role model does not fit shadcn's contract.** The installed
primitives read about twenty variables, and two role names collide: shadcn's
`--accent` is the hover/selected surface used by ghost and outline buttons, not a
brand colour, and `muted` is a surface while `muted-foreground` is muted text.
Implemented literally, repainting `--accent` repaints hover states everywhere.
The brief also promised type hierarchy while the token layer is colour-only —
there is no type scale, and radius is one value with per-size `rounded-md`
hardcoded in `button.tsx`. The fix is a role→token table plus a type scale and a
three-step radius, not more colours.

**"Capture from anywhere" is a shell change, not a button.** The bottom bar is a
Radix `TabsList` acting as the router (`App.tsx:230`), capture renders inside the
home tab, and meal-detail and onboarding early-return before the bar exists. A
capture action cannot be a `TabsTrigger` (it owns no panel) and would inherit a
36px base height and a hardcoded `pb-24` scroll reserve. The work is an
`<AppShell>` owning bar, capture and safe area above the route branches, with
touch-height variants added to `Button`.

**Home's real failure is answering four questions instead of one.** Four equal
76px rings are an instrument panel, and the clamp means "over" is invisible as a
quantity. The proposal: one verdict line derived from the totals (on track /
protein short / over by N), the calories ring as that verdict's frame, and the
three macros as one subordinate row. Status moves out of hue into shape and text
— the ring can draw a second arc past twelve o'clock, so "over" is geometry and
the accent never has to mean "bad".

**Capture is currently a non-idempotent one-shot.** `App.tsx:177-193` calls
`analyze` then immediately `logWithPhoto`; a failure in the second call throws the
analysis away behind a toast, and `capturing` is component state, so backgrounding
the app on iOS loses the photo. Promoting capture to the primary action makes this
the most damaging path in the app: it needs a stated state machine, a persisted
draft and an idempotency key.

**Removing prose needs a split, not a sweep.** Two kinds of copy were identified:
text that explains the product (delete) and text that encodes non-obvious
behaviour a control cannot show — the 15-minute reminder snap, the timezone
reminders are read in, the free-tier request budget. The second kind stays as one
inline line attached to its control. The help accordion also needs a stated entry
point from the screen where confusion happens.

**Warmth and legibility are separate materials, not a compromise.** Asking one
accent to carry appetite and status was the weakest single-colour decision.
Warmth belongs to imagery — the meal photo leading its row, empty-state tiles —
while the measurement zone (rings, numbers) stays a neutral instrument card. That
also fixes the 48px thumbnail doing the work the palette was supposed to do.

**Scope and risk.** This is a solo developer rebuilding roughly 2,100 lines of
screen code across Home, Settings and Meal Detail, plus five primitives, plus
tests that currently assert the copy being removed. Two lenses argued for a
smaller first release: tokens, shell, Home and Settings recomposed; other screens
converted when next touched. There is no success measure in the brief, no service
worker or rollback story, and `pnpm deploy` pushes straight to main — a full
retheme reaches installed clients in one shot.

**Rejected findings.** The zoom-out lens claimed the PWA has no identity and that
auth is the real blocker; false here — anonymous device accounts plus Google
sign-in already ship (`AccountCard.tsx:35,131` call `/api/auth/me` and
`/api/auth/start/google`). The claim that `HomeScreen` mounts the capture controls
was wrong and is corrected above. "Shadcn is mostly bypassed" overstated it:
`Button`, `Card` and `Skeleton` are used.

## Goals vs. Non-Goals

**In scope**

- Own token system with a role→token mapping table, light and dark, a named
  mechanism, a type scale and a three-step radius. Contrast target 4.5:1 body /
  3:1 large, asserted in a test.
- A food-led visual world: warmth carried by photography, not by the accent.
- Home is read-first: date → one verdict with the calories ring → three macros →
  today's meals. Weekly is a mode of the same header.
- Capture is the centre action of a three-slot bar (Home · Capture · Settings),
  backed by a sheet with a stated state machine.
- Preserved, as requested: the Daily/Weekly toggle (including its Total/Daily-avg
  sub-control), the macro rings, and the date stepper. The stepper steps a week in
  Weekly mode instead of silently doing nothing inside a calendar week.
- Every screen rebuilt on customised shadcn primitives; toggle-group added and
  both segmented controls rebuilt from it.
- Prose split: product explanation deleted (moved to help), behaviour explanation
  kept as one inline line per control.
- iOS PWA conventions: 44pt targets, `env(safe-area-inset-*)`,
  `viewport-fit=cover`, system light/dark, no Telegram chrome or theme dependency.
- A first-run state that answers the question without targets: one line and one
  action, not a card of prose.

**Out of scope**

- Worker API, data model, migrations, auth. This is a client redesign.
- A native app, widgets, Live Activities, push notifications.
- An in-app light/dark override: the OS decides.
- Rewriting the bot's messages or flows.

## Alternatives Weighed

- **Keep inheriting Telegram theme variables** — rejected: they are inert in the
  PWA anyway, and the palette must be stable and contrast-tested.
- **Centre-tab capture** — chosen. Rivals: capture as a top button (rejected:
  Home must answer a question before offering a verb); floating action button
  (rejected: overlaps list content and fights the iOS edge).
- **One accent for appetite and status** — rejected: status moves to geometry
  (a second arc, a text label), the accent stays food.
- **Four equal rings as the answer** — rejected: four questions, and "over" is
  unrepresentable. Replaced by a verdict plus one ring plus a macro row.
- **Two-bucket Settings** — rejected: it cannot hold ten blocks. Three groups:
  Today's targets / Logging & AI / Account & data.
- **Keep the prose and tighten it** — rejected: the paragraphs exist because the
  layout fails to make the answer obvious; only behaviour-encoding copy stays.
- **Adopt stock shadcn** — rejected: stock shadcn in dark mode is the generic look
  this replaces.
- **Rebuild every screen now** — rejected in favour of tokens, shell, Home and
  Settings first; Meal Detail and Onboarding converted when next touched.

## Key Decisions & Staging for Next Steps

1. **Dark mode mechanism:** `:root` = light tokens, dark values under
   `@media (prefers-color-scheme: dark)`; delete the unused `@custom-variant dark`
   class variant; add `color-scheme: light dark` and per-mode `theme-color` metas.
2. **Token table:** brand colour becomes `--primary`; `--accent` stays shadcn's
   state surface; add `--success` and `--warning` for status; add display/title/
   body/caption type scale and a three-step radius; remove per-size `rounded-md`
   from `Button` variants.
3. **Shell before screens:** extract `<AppShell>` owning the bottom bar, the
   capture action (a sibling `Button`, not a tab), safe-area padding and the
   scroll reserve. Add `touch` (44px) and `icon-touch` sizes to `Button`.
4. **Bottom bar:** Home · Capture · Settings, each a 44pt target, raised centre,
   inset above the home-indicator band.
5. **Home recomposition:** date pill (stepper; week-step in Weekly mode) →
   verdict line + calories ring → three-macro row → meal list. Empty state is one
   line and one action; the "set a goal" card becomes one line in the ring slot.
6. **Capture sheet state machine:** idle → source → analysing → review → saving →
   error, with a persisted draft, retry from the sheet, and an idempotency key so
   a retry cannot log twice.
7. **Settings in three groups:** Today's targets / Logging & AI / Account & data,
   every existing block assigned a destination; connection status surfaces in the
   capture failure state with a one-tap route to the key field.
8. **Copy rule:** one line per element; behaviour-encoding copy stays inline;
   product explanation moves to the help accordion, which gets an entry point on
   each working surface that needs it.
9. **Feedback without haptics:** every action that used haptics (refresh,
   swipe-delete, capture success) gets a visible state change or toast.
10. **Sequencing:** tokens + shell + Home + Settings, with tests rewritten as the
    acceptance spec first; Meal Detail and Onboarding converted when next touched;
    preview deploy on a branch before main.

## Open Questions

- Does the verdict line ship in v1 (it needs a rule and an owner for what
  "on track" means), or does v1 keep four rings with only the over-arc fix?
- Is the inline AI edit on a Home row preserved? The tests pin it; the brief never
  mentions it.
- Does the streak line survive the read-first header, or fold into the verdict?

## What shipped in this slice

- `index.css`: own palette for light and dark (`prefers-color-scheme`, no `.dark`
  class, no in-app switch), `color-scheme` per mode, `--success` / `--warning`,
  a type scale (display / title / body / caption), a three-step radius, and
  safe-area helpers. Palette contrast is asserted in `src/index.test.ts`.
- `ui/button.tsx`: `default` is now 44px, with `touch` / `icon-sm` added and the
  per-size `rounded-md` removed so radius comes from the scale.
- `ui/toggle-group.tsx`: new primitive (Radix), replacing both hand-rolled
  segmented controls. Root 52px so the item itself clears 44.
- `AppShell.tsx`: the bottom bar, capture action, safe-area inset and scroll
  reserve moved out of the router. Capture is a sibling button, not a tab.
- `CaptureSheet.tsx`: capture as a state machine (idle → analysing → review →
  saving → error) with a retryable save; replaces the one-shot analyze+log.
- `HomeScreen.tsx`: date + Daily/Weekly header, verdict (never before there is
  evidence), the calories ring as the verdict's frame, three macros as a row,
  then meals. One manual entry point; the camera is the only photo entry.
- `ProgressRing.tsx`: over-target draws a second arc instead of clamping, and an
  empty ring draws no round-capped artefact.
- `SettingsScreen.tsx`: three groups (Today's targets / Logging & AI / Account &
  data), account moved next to data, product prose removed, behaviour copy kept
  (the 15-minute snap, the quota ceiling).
- `AccountCard.tsx`: rebuilt on Button/Input/Card, so the Google action is a
  labelled 44px button instead of an unlabelled blue bar.
- `index.html`: the marketing hero is gone, so a cold start no longer flashes
  "Open in Telegram" before the app.

## Still open

- The capture sheet has not been exercised with a real photo end to end (no key
  on the test account); its error and retry paths are covered by inspection only.
- Meal Detail and Onboarding are unstyled by this slice and still carry older
  spacing and copy.
- The verdict rule ("protein short" below 80% of target) is a placeholder; it
  needs a stated definition before it can be trusted.
