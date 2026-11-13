/**
 * Advanced analytics — pure derivation from stored meals. No AI, no photos, no
 * clock: the caller supplies local day-keys and local hours, so the same inputs
 * always produce the same report.
 *
 * The reports answer questions the daily rings cannot: how intake moved over
 * three months or a year, which weeks actually hit the targets, which weekdays
 * and times carry the outliers, which dishes recur, and whether portions are
 * drifting. Everything here is arithmetic over rows the user already owns.
 */

import { shiftDayKey } from './stats.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export type ReportRange = '90d' | '12m';
export type ReportGoal = 'lose' | 'maintain' | 'gain';

/** One food line, already multiplied by its quantity. */
export interface ReportFood {
  name: string;
  /** Total grams for this line, or null when the amount is unknown. */
  weightG: number | null;
}

/** One logged meal, reduced to what the reports need. */
export interface ReportMeal {
  loggedAt: number;
  /** `YYYY-MM-DD` in the user's local timezone. */
  dayKey: string;
  /** Local hour, 0–23. */
  hour: number;
  energyKcal: number;
  proteinG: number;
  foods: readonly ReportFood[];
}

/** Targets + body context used by adherence and the projection. */
export interface ReportTarget {
  energyKcal: number;
  proteinG: number;
  weightKg: number;
  goal: ReportGoal;
}

export interface ReportTrendPoint {
  /** `YYYY-MM-DD` for 90d, `YYYY-MM` for 12m. */
  key: string;
  label: string;
  energyKcal: number;
  proteinG: number;
  meals: number;
}

/** One calendar week (Monday–Sunday), clipped to the report range. */
export interface ReportWeek {
  weekStartKey: string;
  /** Days of this week inside the range and up to today. */
  daysInWindow: number;
  loggedDays: number;
  avgKcal: number;
  avgProteinG: number;
  proteinHitDays: number;
  kcalHitDays: number;
  /**
   * Days that hit both targets, as a share of the days in the window (0–100).
   * Unlogged days count as misses, so consistency is part of the score.
   * null when there is no target.
   */
  scorePct: number | null;
}

export interface ReportWeekday {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  label: string;
  loggedDays: number;
  meals: number;
  avgKcal: number;
}

export type ReportTimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ReportTimeOfDay {
  bucket: ReportTimeBucket;
  label: string;
  meals: number;
  sharePct: number;
  avgKcal: number;
}

export interface ReportDish {
  name: string;
  /** Number of meals that contained this dish. */
  meals: number;
  /** Share of all meals in the range (0–100). */
  sharePct: number;
}

export interface ReportPortionDrift {
  name: string;
  firstWeightG: number;
  lastWeightG: number;
  deltaG: number;
  deltaPct: number;
  observations: number;
}

/**
 * A calorie-based projection. Without a goal weight in the profile, the
 * milestone is a 5% body-weight change in the profile's goal direction, which
 * is the standard clinically meaningful first target.
 */
export interface ReportProjection {
  goal: ReportGoal;
  /** Days examined for the current rate (the last 14, including today). */
  windowDays: number;
  loggedDays: number;
  avgKcal: number;
  targetKcal: number;
  deltaKcalPerDay: number;
  /** Estimated kg per week at 7700 kcal per kg. */
  kgPerWeek: number;
  onPace: boolean;
  milestoneWeightKg: number | null;
  projectedDateKey: string | null;
}

/** The trailing seven-day card shown at the top of the report. */
export interface ReportCard {
  windowStartKey: string;
  daysInWindow: number;
  daysLogged: number;
  daysOnTarget: number;
  scorePct: number | null;
  avgKcal: number;
  avgProteinG: number;
}

export interface ReportTotals {
  meals: number;
  loggedDays: number;
  avgKcalPerLoggedDay: number;
  avgProteinPerLoggedDay: number;
  avgMealsPerLoggedDay: number;
}

export interface AdvancedReport {
  range: ReportRange;
  todayKey: string;
  rangeStartKey: string;
  series: ReportTrendPoint[];
  weeks: ReportWeek[];
  weekdays: ReportWeekday[];
  timeOfDay: ReportTimeOfDay[];
  dishes: ReportDish[];
  portionDrift: ReportPortionDrift[];
  projection: ReportProjection | null;
  card: ReportCard;
  totals: ReportTotals;
}

export interface AdvancedReportInput {
  range: ReportRange;
  todayKey: string;
  meals: readonly ReportMeal[];
  target: ReportTarget | null;
}

/** One local day's totals, already summed by the database. */
export interface ReportDayAggregate {
  dayKey: string;
  energyKcal: number;
  proteinG: number;
  meals: number;
}

/** Meals and kcal for one local hour, already counted by the database. */
export interface ReportHourAggregate {
  /** Local hour, 0–23. */
  hour: number;
  meals: number;
  energyKcal: number;
}

/** Meals containing one dish, already grouped by the database. */
export interface ReportDishAggregate {
  name: string;
  meals: number;
}

/**
 * First and last observed portion for one dish. The database provides the
 * endpoints and the observation count; the report derives the drift.
 */
export interface ReportPortionAggregate {
  name: string;
  firstWeightG: number;
  lastWeightG: number;
  observations: number;
}

/**
 * A report built from rows the database already grouped. Every aggregate must
 * already be scoped to the report range (and to the user's timezone) so this
 * stays a pure assembly step.
 */
export interface AdvancedReportAggregateInput {
  range: ReportRange;
  todayKey: string;
  days: readonly ReportDayAggregate[];
  hours: readonly ReportHourAggregate[];
  dishes: readonly ReportDishAggregate[];
  portions: readonly ReportPortionAggregate[];
  target: ReportTarget | null;
}

const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Parses a `YYYY-MM-DD` key to UTC midnight. */
function keyToMs(key: string): number {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** `YYYY-MM-DD` for a UTC-midnight epoch. */
function msToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The first day the report covers. */
export function reportRangeStartKey(range: ReportRange, todayKey: string): string {
  if (range === '90d') return shiftDayKey(todayKey, -89);
  const today = new Date(keyToMs(todayKey));
  return msToKey(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
}

/** Maps a profile goal stage (`lose_steady`, `gain_lean`, …) to a direction. */
export function reportGoal(goal: string | null | undefined): ReportGoal {
  if (goal?.startsWith('lose')) return 'lose';
  if (goal?.startsWith('gain')) return 'gain';
  return 'maintain';
}

/** The Monday starting the calendar week that contains `key`. */
function weekStartKey(key: string): string {
  const ms = keyToMs(key);
  const weekday = new Date(ms).getUTCDay();
  return msToKey(ms - ((weekday + 6) % 7) * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return round((keyToMs(to) - keyToMs(from)) / DAY_MS);
}

function normalizeFood(name: string): string {
  return name.trim().toLowerCase();
}

interface DayAggregate {
  energyKcal: number;
  proteinG: number;
  meals: number;
}

function aggregateDays(meals: readonly ReportMeal[]): Map<string, DayAggregate> {
  const days = new Map<string, DayAggregate>();
  for (const meal of meals) {
    const day = days.get(meal.dayKey) ?? { energyKcal: 0, proteinG: 0, meals: 0 };
    day.energyKcal += meal.energyKcal;
    day.proteinG += meal.proteinG;
    day.meals += 1;
    days.set(meal.dayKey, day);
  }
  return days;
}

function dailySeries(
  rangeStartKey: string,
  todayKey: string,
  days: Map<string, DayAggregate>,
): ReportTrendPoint[] {
  const points: ReportTrendPoint[] = [];
  const count = daysBetween(rangeStartKey, todayKey) + 1;
  for (let i = 0; i < count; i++) {
    const key = shiftDayKey(rangeStartKey, i);
    const day = days.get(key);
    const date = new Date(keyToMs(key));
    points.push({
      key,
      label: `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`,
      energyKcal: round(day?.energyKcal ?? 0),
      proteinG: round(day?.proteinG ?? 0),
      meals: day?.meals ?? 0,
    });
  }
  return points;
}

function monthlySeries(rangeStartKey: string, days: Map<string, DayAggregate>): ReportTrendPoint[] {
  const byMonth = new Map<string, { energyKcal: number; proteinG: number; meals: number }>();
  for (const [key, day] of days) {
    const monthKey = key.slice(0, 7);
    const month = byMonth.get(monthKey) ?? { energyKcal: 0, proteinG: 0, meals: 0 };
    month.energyKcal += day.energyKcal;
    month.proteinG += day.proteinG;
    month.meals += day.meals;
    byMonth.set(monthKey, month);
  }

  const start = new Date(keyToMs(rangeStartKey));
  const points: ReportTrendPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = date.toISOString().slice(0, 7);
    const month = byMonth.get(key);
    points.push({
      key,
      label: `${MONTH_LABELS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`,
      energyKcal: round(month?.energyKcal ?? 0),
      proteinG: round(month?.proteinG ?? 0),
      meals: month?.meals ?? 0,
    });
  }
  return points;
}

function weeklyAdherence(
  rangeStartKey: string,
  todayKey: string,
  days: Map<string, DayAggregate>,
  target: ReportTarget | null,
): ReportWeek[] {
  const weeks: ReportWeek[] = [];
  const lastWeekStart = weekStartKey(todayKey);

  for (
    let cursor = weekStartKey(rangeStartKey);
    cursor <= lastWeekStart;
    cursor = shiftDayKey(cursor, 7)
  ) {
    const windowStart = cursor < rangeStartKey ? rangeStartKey : cursor;
    const calendarEnd = shiftDayKey(cursor, 6);
    const windowEnd = calendarEnd > todayKey ? todayKey : calendarEnd;
    const daysInWindow = daysBetween(windowStart, windowEnd) + 1;
    if (daysInWindow <= 0) continue;

    let loggedDays = 0;
    let sumKcal = 0;
    let sumProtein = 0;
    let proteinHitDays = 0;
    let kcalHitDays = 0;
    let bothHitDays = 0;

    for (const [key, day] of days) {
      if (key < windowStart || key > windowEnd) continue;
      loggedDays += 1;
      sumKcal += day.energyKcal;
      sumProtein += day.proteinG;
      if (!target) continue;

      const kcalHit = Math.abs(day.energyKcal - target.energyKcal) <= target.energyKcal * 0.1;
      const proteinHit = target.proteinG > 0 && day.proteinG >= target.proteinG * 0.9;
      if (kcalHit) kcalHitDays += 1;
      if (proteinHit) proteinHitDays += 1;
      if (kcalHit && proteinHit) bothHitDays += 1;
    }

    weeks.push({
      weekStartKey: cursor,
      daysInWindow,
      loggedDays,
      avgKcal: loggedDays > 0 ? round(sumKcal / loggedDays) : 0,
      avgProteinG: loggedDays > 0 ? round(sumProtein / loggedDays) : 0,
      proteinHitDays,
      kcalHitDays,
      scorePct: target ? round((bothHitDays / daysInWindow) * 100) : null,
    });
  }

  return weeks;
}

function weekdayPattern(days: Map<string, DayAggregate>): ReportWeekday[] {
  const buckets = WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    loggedDays: 0,
    meals: 0,
    kcal: 0,
  }));

  for (const [key, day] of days) {
    const bucket = buckets[new Date(keyToMs(key)).getUTCDay()];
    if (!bucket) continue;
    bucket.loggedDays += 1;
    bucket.meals += day.meals;
    bucket.kcal += day.energyKcal;
  }

  return buckets.map(({ weekday, label, loggedDays, meals, kcal }) => ({
    weekday,
    label,
    loggedDays,
    meals,
    avgKcal: loggedDays > 0 ? round(kcal / loggedDays) : 0,
  }));
}

function timeOfDayPattern(hours: readonly ReportHourAggregate[]): ReportTimeOfDay[] {
  const buckets: Array<Omit<ReportTimeOfDay, 'sharePct' | 'avgKcal'> & { kcal: number }> = [
    { bucket: 'morning', label: 'Morning · 5–11', meals: 0, kcal: 0 },
    { bucket: 'afternoon', label: 'Afternoon · 11–17', meals: 0, kcal: 0 },
    { bucket: 'evening', label: 'Evening · 17–22', meals: 0, kcal: 0 },
    { bucket: 'night', label: 'Night · 22–5', meals: 0, kcal: 0 },
  ];

  for (const row of hours) {
    const index =
      row.hour >= 5 && row.hour < 11
        ? 0
        : row.hour >= 11 && row.hour < 17
          ? 1
          : row.hour >= 17 && row.hour < 22
            ? 2
            : 3;
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.meals += row.meals;
    bucket.kcal += row.energyKcal;
  }

  const total = hours.reduce((sum, row) => sum + row.meals, 0);
  return buckets.map(({ bucket, label, meals: count, kcal }) => ({
    bucket,
    label,
    meals: count,
    sharePct: total > 0 ? round((count / total) * 100) : 0,
    avgKcal: count > 0 ? round(kcal / count) : 0,
  }));
}

function dishFrequency(dishes: readonly ReportDishAggregate[], totalMeals: number): ReportDish[] {
  return dishes
    .map((dish) => ({
      name: dish.name,
      meals: dish.meals,
      sharePct: totalMeals > 0 ? round((dish.meals / totalMeals) * 100) : 0,
    }))
    .sort((a, b) => (b.meals !== a.meals ? b.meals - a.meals : a.name < b.name ? -1 : 1))
    .slice(0, 8);
}

function portionDrift(portions: readonly ReportPortionAggregate[]): ReportPortionDrift[] {
  const drift: ReportPortionDrift[] = [];

  for (const portion of portions) {
    if (portion.observations < 3) continue;
    if (!(portion.firstWeightG > 0)) continue;

    const deltaPct = round(
      ((portion.lastWeightG - portion.firstWeightG) / portion.firstWeightG) * 100,
    );
    if (Math.abs(deltaPct) < 5) continue;

    drift.push({
      name: portion.name,
      firstWeightG: round1(portion.firstWeightG),
      lastWeightG: round1(portion.lastWeightG),
      deltaG: round1(portion.lastWeightG - portion.firstWeightG),
      deltaPct,
      observations: portion.observations,
    });
  }

  return drift
    .sort((a, b) =>
      Math.abs(b.deltaPct) !== Math.abs(a.deltaPct)
        ? Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
        : a.name < b.name
          ? -1
          : 1,
    )
    .slice(0, 5);
}

function projectionFor(
  days: Map<string, DayAggregate>,
  target: ReportTarget | null,
  todayKey: string,
): ReportProjection | null {
  if (!target) return null;

  const windowStart = shiftDayKey(todayKey, -13);
  let loggedDays = 0;
  let sumKcal = 0;
  for (const [key, day] of days) {
    if (key < windowStart || key > todayKey) continue;
    loggedDays += 1;
    sumKcal += day.energyKcal;
  }

  // Fewer than three logged days cannot carry a rate honestly.
  if (loggedDays < 3) return null;

  const avgKcal = round(sumKcal / loggedDays);
  const deltaKcalPerDay = avgKcal - target.energyKcal;
  const rawKgPerWeek = (deltaKcalPerDay * 7) / 7700;
  const kgPerWeek = round1(rawKgPerWeek);
  const onPace =
    target.goal === 'lose'
      ? deltaKcalPerDay < 0
      : target.goal === 'gain'
        ? deltaKcalPerDay > 0
        : Math.abs(deltaKcalPerDay) <= 200;

  let milestoneWeightKg: number | null = null;
  let projectedDateKey: string | null = null;

  if (target.goal === 'lose') {
    milestoneWeightKg = round1(target.weightKg * 0.95);
    if (rawKgPerWeek < 0) {
      const weeks = (target.weightKg - milestoneWeightKg) / Math.abs(rawKgPerWeek);
      projectedDateKey = dateWithinFiveYears(todayKey, weeks * 7);
    }
  } else if (target.goal === 'gain') {
    milestoneWeightKg = round1(target.weightKg * 1.05);
    if (rawKgPerWeek > 0) {
      const weeks = (milestoneWeightKg - target.weightKg) / rawKgPerWeek;
      projectedDateKey = dateWithinFiveYears(todayKey, weeks * 7);
    }
  }

  return {
    goal: target.goal,
    windowDays: 14,
    loggedDays,
    avgKcal,
    targetKcal: target.energyKcal,
    deltaKcalPerDay,
    kgPerWeek,
    onPace,
    milestoneWeightKg,
    projectedDateKey,
  };
}

/** A projection further than five years out is not a useful promise. */
function dateWithinFiveYears(todayKey: string, days: number): string | null {
  const rounded = round(days);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 365 * 5) return null;
  return shiftDayKey(todayKey, rounded);
}

function reportCard(
  days: Map<string, DayAggregate>,
  target: ReportTarget | null,
  todayKey: string,
): ReportCard {
  const windowStartKey = shiftDayKey(todayKey, -6);
  let daysLogged = 0;
  let sumKcal = 0;
  let sumProtein = 0;
  let daysOnTarget = 0;

  for (const [key, day] of days) {
    if (key < windowStartKey || key > todayKey) continue;
    daysLogged += 1;
    sumKcal += day.energyKcal;
    sumProtein += day.proteinG;
    if (!target) continue;
    const kcalHit = Math.abs(day.energyKcal - target.energyKcal) <= target.energyKcal * 0.1;
    const proteinHit = target.proteinG > 0 && day.proteinG >= target.proteinG * 0.9;
    if (kcalHit && proteinHit) daysOnTarget += 1;
  }

  return {
    windowStartKey,
    daysInWindow: 7,
    daysLogged,
    daysOnTarget,
    scorePct: target ? round((daysOnTarget / 7) * 100) : null,
    avgKcal: daysLogged > 0 ? round(sumKcal / daysLogged) : 0,
    avgProteinG: daysLogged > 0 ? round(sumProtein / daysLogged) : 0,
  };
}

function reportTotals(mealCount: number, days: Map<string, DayAggregate>): ReportTotals {
  let sumKcal = 0;
  let sumProtein = 0;
  for (const day of days.values()) {
    sumKcal += day.energyKcal;
    sumProtein += day.proteinG;
  }
  const loggedDays = days.size;
  return {
    meals: mealCount,
    loggedDays,
    avgKcalPerLoggedDay: loggedDays > 0 ? round(sumKcal / loggedDays) : 0,
    avgProteinPerLoggedDay: loggedDays > 0 ? round(sumProtein / loggedDays) : 0,
    avgMealsPerLoggedDay: loggedDays > 0 ? round1(mealCount / loggedDays) : 0,
  };
}

function daysFromMeals(meals: readonly ReportMeal[]): ReportDayAggregate[] {
  return [...aggregateDays(meals)].map(([dayKey, day]) => ({ dayKey, ...day }));
}

function hoursFromMeals(meals: readonly ReportMeal[]): ReportHourAggregate[] {
  const byHour = new Map<number, { meals: number; energyKcal: number }>();
  for (const meal of meals) {
    const hour = byHour.get(meal.hour) ?? { meals: 0, energyKcal: 0 };
    hour.meals += 1;
    hour.energyKcal += meal.energyKcal;
    byHour.set(meal.hour, hour);
  }
  return [...byHour].map(([hour, aggregate]) => ({ hour, ...aggregate }));
}

function dishesFromMeals(meals: readonly ReportMeal[]): ReportDishAggregate[] {
  const names = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const meal of meals) {
    const seen = new Set<string>();
    for (const food of meal.foods) {
      const key = normalizeFood(food.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!names.has(key)) names.set(key, food.name.trim());
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([key, count]) => ({
    name: names.get(key) ?? key,
    meals: count,
  }));
}

function portionsFromMeals(meals: readonly ReportMeal[]): ReportPortionAggregate[] {
  const names = new Map<string, string>();
  const points = new Map<string, Array<{ loggedAt: number; weightG: number }>>();

  for (const meal of meals) {
    for (const food of meal.foods) {
      const key = normalizeFood(food.name);
      if (!key || food.weightG == null || !(food.weightG > 0)) continue;
      if (!names.has(key)) names.set(key, food.name.trim());
      const list = points.get(key) ?? [];
      list.push({ loggedAt: meal.loggedAt, weightG: food.weightG });
      points.set(key, list);
    }
  }

  return [...points.entries()].map(([key, list]) => {
    list.sort((a, b) => a.loggedAt - b.loggedAt);
    const first = list[0];
    const last = list[list.length - 1];
    return {
      name: names.get(key) ?? key,
      firstWeightG: first?.weightG ?? 0,
      lastWeightG: last?.weightG ?? 0,
      observations: list.length,
    };
  });
}

/**
 * Builds the complete report. Meals outside the range are ignored, so the API
 * can hand over a generous query window without changing the answer.
 */
export function buildAdvancedReport(input: AdvancedReportInput): AdvancedReport {
  const rangeStartKey = reportRangeStartKey(input.range, input.todayKey);
  const meals = input.meals
    .filter((meal) => meal.dayKey >= rangeStartKey && meal.dayKey <= input.todayKey)
    .slice()
    .sort((a, b) => a.loggedAt - b.loggedAt);

  return buildAdvancedReportFromAggregates({
    range: input.range,
    todayKey: input.todayKey,
    days: daysFromMeals(meals),
    hours: hoursFromMeals(meals),
    dishes: dishesFromMeals(meals),
    portions: portionsFromMeals(meals),
    target: input.target,
  });
}

/**
 * Builds the same report from database aggregates. This is the API's path: the
 * Worker groups totals per local day (and per hour/dish) in SQL, so a long
 * range never ships every meal row to the Worker.
 */
export function buildAdvancedReportFromAggregates(
  input: AdvancedReportAggregateInput,
): AdvancedReport {
  const rangeStartKey = reportRangeStartKey(input.range, input.todayKey);
  const days = new Map<string, DayAggregate>();
  let mealCount = 0;

  for (const day of input.days) {
    if (day.dayKey < rangeStartKey || day.dayKey > input.todayKey) continue;
    const aggregate = days.get(day.dayKey) ?? { energyKcal: 0, proteinG: 0, meals: 0 };
    aggregate.energyKcal += day.energyKcal;
    aggregate.proteinG += day.proteinG;
    aggregate.meals += day.meals;
    days.set(day.dayKey, aggregate);
    mealCount += day.meals;
  }

  return {
    range: input.range,
    todayKey: input.todayKey,
    rangeStartKey,
    series:
      input.range === '90d'
        ? dailySeries(rangeStartKey, input.todayKey, days)
        : monthlySeries(rangeStartKey, days),
    weeks: weeklyAdherence(rangeStartKey, input.todayKey, days, input.target),
    weekdays: weekdayPattern(days),
    timeOfDay: timeOfDayPattern(input.hours),
    dishes: dishFrequency(input.dishes, mealCount),
    portionDrift: portionDrift(input.portions),
    projection: projectionFor(days, input.target, input.todayKey),
    card: reportCard(days, input.target, input.todayKey),
    totals: reportTotals(mealCount, days),
  };
}
