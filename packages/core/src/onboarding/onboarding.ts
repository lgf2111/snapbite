/**
 * Pure, conversational onboarding step-machine for the Telegram bot. The Worker
 * persists {@link OnboardingState} between messages (in preferences_json) and
 * uses these helpers to prompt, parse each answer, and build a final
 * {@link UserProfile}. No I/O here.
 *
 * We collect the six fields {@link computeTargets} needs: sex, age, heightCm,
 * weightKg, activity, goal. Units are normalized to metric on the way in, so
 * the stored profile is always canonical.
 */
import {
  type ActivityLevel,
  ageFromBirthDate,
  feetInchesToCm,
  type Goal,
  GOAL_LABELS,
  GOAL_STAGES,
  lbToKg,
  type Sex,
  UserProfile,
} from '../profile/profile.js';

/** Ordered onboarding steps. The last step, once answered, completes the flow. */
export const ONBOARDING_STEPS = [
  'sex',
  'birthday',
  'height',
  'weight',
  'activity',
  'goal',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Partial profile accumulated across answers (all optional until complete). */
export interface OnboardingPartial {
  sex?: Sex;
  /** ISO YYYY-MM-DD; age is derived from this so it stays current. */
  birthDate?: string;
  heightCm?: number;
  weightKg?: number;
  activity?: ActivityLevel;
  goal?: Goal;
}

/** Persisted between messages while a user is mid-onboarding. */
export interface OnboardingState {
  step: OnboardingStep;
  partial: OnboardingPartial;
}

/** A parse result: ok with the value, or an error message to re-prompt with. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ACTIVITY_OPTIONS: { key: ActivityLevel; label: string }[] = [
  { key: 'sedentary', label: 'Sedentary (little/no exercise)' },
  { key: 'light', label: 'Light (1–3 days/week)' },
  { key: 'moderate', label: 'Moderate (3–5 days/week)' },
  { key: 'active', label: 'Active (6–7 days/week)' },
  { key: 'very_active', label: 'Very active (hard training/physical job)' },
];

/** The prompt text shown to the user for a given step. */
export function promptFor(step: OnboardingStep): string {
  switch (step) {
    case 'sex':
      return "Let's set up your goal. First — what's your sex? Reply *male* or *female*.";
    case 'birthday':
      return "What's your date of birth? Send it as `YYYY-MM-DD` (e.g. 1998-04-25). I'll keep your age up to date automatically.";
    case 'height':
      return "What's your height? e.g. `175cm` or `5'9`.";
    case 'weight':
      return "What's your weight? e.g. `70kg` or `155lb`.";
    case 'activity':
      return [
        'How active are you? Reply with a number:',
        ...ACTIVITY_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`),
      ].join('\n');
    case 'goal':
      return [
        "What's your goal? Reply with a number:",
        ...GOAL_STAGES.map((g, i) => `${i + 1}. ${GOAL_LABELS[g]}`),
      ].join('\n');
  }
}

/** The first prompt + fresh state when a user starts onboarding. */
export function startOnboarding(): { state: OnboardingState; prompt: string } {
  return { state: { step: 'sex', partial: {} }, prompt: promptFor('sex') };
}

// --- per-step answer parsers ------------------------------------------------

function parseSex(text: string): ParseResult<Sex> {
  const t = text.trim().toLowerCase();
  if (['male', 'm', 'man', 'boy'].includes(t)) return { ok: true, value: 'male' };
  if (['female', 'f', 'woman', 'girl'].includes(t)) return { ok: true, value: 'female' };
  return { ok: false, error: 'Please reply *male* or *female* (or m/f).' };
}

/** Accepts `YYYY-MM-DD` (also tolerates `/` or `.` separators). Returns ISO. */
function parseBirthday(text: string): ParseResult<string> {
  const t = text.trim().replace(/[./]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) {
    return { ok: false, error: 'Please send your birth date as YYYY-MM-DD, e.g. 1998-04-25.' };
  }
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  const age = ageFromBirthDate(iso);
  if (age == null) {
    return { ok: false, error: "That date doesn't look valid — try YYYY-MM-DD, e.g. 1998-04-25." };
  }
  if (age < 13 || age > 100) {
    return { ok: false, error: 'Your age (from that date) must be between 13 and 100.' };
  }
  return { ok: true, value: iso };
}

/** Accepts `175cm`, `175`, `1.75m`, `5'9`, `5ft9`, `5 9`. Returns cm. */
function parseHeight(text: string): ParseResult<number> {
  const t = text.trim().toLowerCase();

  // Feet/inches: 5'9, 5'9", 5ft9, 5 ft 9 in, 5 9
  const ftIn = t.match(/(\d+)\s*(?:'|ft|feet|foot)\s*(\d+)?/);
  if (ftIn) {
    const feet = Number(ftIn[1]);
    const inches = ftIn[2] ? Number(ftIn[2]) : 0;
    const cm = feetInchesToCm(feet, inches);
    if (cm > 90 && cm < 250) return { ok: true, value: round1(cm) };
    return { ok: false, error: 'That height seems off — try like `5\'9` or `175cm`.' };
  }

  // Meters: 1.75m
  const meters = t.match(/^(\d(?:\.\d+)?)\s*m$/);
  if (meters) {
    const cm = Number(meters[1]) * 100;
    if (cm > 90 && cm < 250) return { ok: true, value: round1(cm) };
  }

  // Centimeters: 175, 175cm
  const cmNum = Number.parseFloat(t.replace(/[^\d.]/g, ''));
  if (Number.isFinite(cmNum) && cmNum > 90 && cmNum < 250) {
    return { ok: true, value: round1(cmNum) };
  }
  return { ok: false, error: 'Please send your height, e.g. `175cm` or `5\'9`.' };
}

/** Accepts `70kg`, `70`, `155lb`, `155 lbs`. Returns kg. */
function parseWeight(text: string): ParseResult<number> {
  const t = text.trim().toLowerCase();
  const num = Number.parseFloat(t.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'Please send your weight, e.g. `70kg` or `155lb`.' };
  }
  const isLb = /lb|lbs|pound/.test(t);
  const kg = isLb ? lbToKg(num) : num;
  if (kg < 25 || kg > 400) return { ok: false, error: 'That weight seems off — try like `70kg` or `155lb`.' };
  return { ok: true, value: round1(kg) };
}

function parseActivity(text: string): ParseResult<ActivityLevel> {
  const t = text.trim().toLowerCase();
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= ACTIVITY_OPTIONS.length) {
    return { ok: true, value: ACTIVITY_OPTIONS[n - 1]!.key };
  }
  // Also accept the word itself (sedentary/light/moderate/active/very active).
  const byWord = ACTIVITY_OPTIONS.find((o) => o.key === t.replace(/\s+/g, '_'));
  if (byWord) return { ok: true, value: byWord.key };
  return { ok: false, error: `Please reply with a number 1–${ACTIVITY_OPTIONS.length}.` };
}

function parseGoal(text: string): ParseResult<Goal> {
  const t = text.trim().toLowerCase();
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= GOAL_STAGES.length) {
    return { ok: true, value: GOAL_STAGES[n - 1]! };
  }
  // Accept the stage key or a label match.
  const byKey = GOAL_STAGES.find((g) => g === t.replace(/\s+/g, '_'));
  if (byKey) return { ok: true, value: byKey };
  const byLabel = GOAL_STAGES.find((g) => GOAL_LABELS[g].toLowerCase() === t);
  if (byLabel) return { ok: true, value: byLabel };
  return { ok: false, error: `Please reply with a number 1–${GOAL_STAGES.length}.` };
}

/**
 * Parses a raw answer for the current step and, on success, returns the updated
 * state (with the value applied). On failure returns the error to re-prompt.
 * When the last step is answered, `done` is true and `profile` is the validated
 * {@link UserProfile} ready to save.
 */
export function applyAnswer(
  state: OnboardingState,
  text: string,
):
  | { ok: false; error: string }
  | { ok: true; done: false; state: OnboardingState; nextPrompt: string }
  | { ok: true; done: true; profile: UserProfile } {
  const partial: OnboardingPartial = { ...state.partial };

  switch (state.step) {
    case 'sex': {
      const r = parseSex(text);
      if (!r.ok) return r;
      partial.sex = r.value;
      break;
    }
    case 'birthday': {
      const r = parseBirthday(text);
      if (!r.ok) return r;
      partial.birthDate = r.value;
      break;
    }
    case 'height': {
      const r = parseHeight(text);
      if (!r.ok) return r;
      partial.heightCm = r.value;
      break;
    }
    case 'weight': {
      const r = parseWeight(text);
      if (!r.ok) return r;
      partial.weightKg = r.value;
      break;
    }
    case 'activity': {
      const r = parseActivity(text);
      if (!r.ok) return r;
      partial.activity = r.value;
      break;
    }
    case 'goal': {
      const r = parseGoal(text);
      if (!r.ok) return r;
      partial.goal = r.value;
      break;
    }
  }

  const idx = ONBOARDING_STEPS.indexOf(state.step);
  const nextStep = ONBOARDING_STEPS[idx + 1];
  if (nextStep) {
    return {
      ok: true,
      done: false,
      state: { step: nextStep, partial },
      nextPrompt: promptFor(nextStep),
    };
  }

  // Last step answered — validate the complete profile.
  const profile = buildProfile(partial);
  if (!profile) {
    // Shouldn't happen if every step validated, but guard anyway.
    return { ok: false, error: 'Something went wrong building your profile — send /setup to restart.' };
  }
  return { ok: true, done: true, profile };
}

/** Builds + validates a UserProfile from a (hopefully complete) partial. */
export function buildProfile(partial: OnboardingPartial): UserProfile | null {
  const parsed = UserProfile.safeParse({
    sex: partial.sex,
    birthDate: partial.birthDate,
    heightCm: partial.heightCm,
    weightKg: partial.weightKg,
    activity: partial.activity,
    goal: partial.goal,
    units: 'metric',
    mode: 'simple',
  });
  return parsed.success ? parsed.data : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
