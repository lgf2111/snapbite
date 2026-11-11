import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Backend, MealDates, RecentMeal } from '@/lib/backend';
import { cacheKey } from '@/lib/cache';
import { hapticNotify } from '@/lib/telegram';
import { useCachedData } from '@/lib/useCachedData';
import { cn } from '@/lib/utils';
import {
  type WeekViewMode,
  loadWeekPrefs,
  loadWeekViewMode,
  saveWeekViewMode,
  weekRange,
} from '@/lib/weekPrefs';
import { type DailyTargets, type MealResult, PROVIDER_PRESETS } from '@snapbite/core';
import { Keyboard, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateSelector } from './DateSelector.js';
import { MacroLegend, MacroLine } from './MacroLine.js';
import { ManualMealDialog } from './ManualMealDialog.js';
import { ProgressRing } from './ProgressRing.js';
import { SwipeableRow } from './SwipeableRow.js';
import { ReviseWithAiDialog } from './UpdateWithAi.js';

type ToastKind = 'success' | 'error' | 'info';

/** Short human labels for the provider id shown on meal cards. */
const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  ...Object.fromEntries(Object.values(PROVIDER_PRESETS).map((p) => [p.id, p.label])),
};

interface HomeScreenProps {
  backend: Backend;
  targets: DailyTargets | null;
  /** Selected day (YYYY-MM-DD), controlled by App so it survives meal open/close. */
  date: string;
  onDateChange: (date: string) => void;
  /** Daily vs weekly view, controlled by App. */
  view: 'daily' | 'weekly';
  onViewChange: (view: 'daily' | 'weekly') => void;
  /** Bumped by App after an edit/delete to trigger a revalidation (no remount). */
  refreshSignal: number;
  onOpenMeal: (meal: RecentMeal) => void;
  onSetGoal: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Home answers one question: am I on track today?
 *
 * The date and the Daily/Weekly switch sit together as the header, the verdict
 * ring carries the answer, the three macros sit under it as evidence, and the
 * meals are the receipts. Capture lives in the app bar, not here — three
 * separate "add a meal" controls on one screen was the old failure.
 */
export function HomeScreen({
  backend,
  targets,
  date,
  onDateChange,
  view,
  onViewChange,
  refreshSignal,
  onOpenMeal,
  onSetGoal,
  onToast,
}: HomeScreenProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The meal being edited with AI inline from Home (null = dialog closed). */
  const [aiMeal, setAiMeal] = useState<RecentMeal | null>(null);

  // Week definition preference (rolling vs calendar Sun/Mon) from Settings.
  const weekPrefs = useMemo(() => loadWeekPrefs(), []);
  const range = useMemo(() => weekRange(date, weekPrefs), [date, weekPrefs]);

  // Weekly aggregation: show the range total, or a per-day average. Persisted.
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>(() => loadWeekViewMode());
  const setWeekMode = useCallback((mode: WeekViewMode) => {
    setWeekViewMode(mode);
    saveWeekViewMode(mode);
  }, []);

  // Meals for the current view, served instantly from cache then revalidated.
  const mealsKey =
    view === 'weekly'
      ? cacheKey.mealsRange(range.startKey, range.endKey)
      : cacheKey.mealsByDate(date);
  const {
    data: mealsData,
    loading: mealsLoading,
    error,
    refresh: refreshMeals,
  } = useCachedData<RecentMeal[]>(mealsKey, () =>
    view === 'weekly'
      ? backend.mealsInRange(range.startKey, range.endKey)
      : backend.mealsByDate(date),
  );
  const meals = mealsLoading ? null : (mealsData ?? []);

  // Logged days for the calendar dots + the current streak (cached).
  const { data: datesData, refresh: refreshDates } = useCachedData<MealDates>(
    cacheKey.mealDates(),
    () => backend.mealDates(),
  );
  const loggedDates = datesData?.dates ?? [];
  const streak = datesData?.streak ?? null;

  const refresh = useCallback(() => {
    refreshMeals();
    refreshDates();
  }, [refreshMeals, refreshDates]);

  // Manual pull: revalidate now (useful if a bot-logged meal hasn't shown yet).
  const manualRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    hapticNotify('success');
    refresh();
    window.setTimeout(() => setRefreshing(false), 700);
  }, [refresh, refreshing]);

  // App bumps refreshSignal after an edit/delete; revalidate without remounting.
  const firstSignal = useRef(refreshSignal);
  useEffect(() => {
    if (firstSignal.current === refreshSignal) return;
    firstSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  // Track which meal ids we've already shown for the CURRENT list key, so a
  // meal that appears later (after logging) animates in.
  const seenIds = useRef<{ key: string; ids: Set<string> }>({ key: mealsKey, ids: new Set() });
  const newIds = useMemo(() => {
    const list = mealsData ?? [];
    const store = seenIds.current;
    if (store.key !== mealsKey) {
      store.key = mealsKey;
      store.ids = new Set(list.map((m) => m.id));
      return new Set<string>();
    }
    const fresh = new Set<string>();
    for (const m of list) {
      if (!store.ids.has(m.id)) {
        fresh.add(m.id);
        store.ids.add(m.id);
      }
    }
    return fresh;
  }, [mealsData, mealsKey]);

  const weekly = view === 'weekly';
  const weeklyAverage = weekly && weekViewMode === 'average';
  // In weekly view the targets scale by the number of days (total), or stay the
  // daily target (average). Daily view always uses the plain daily target.
  const viewTargets = useMemo(() => {
    if (!targets) return null;
    if (!weekly || weeklyAverage) return targets;
    const d = range.days;
    return {
      energyKcal: targets.energyKcal * d,
      proteinG: targets.proteinG * d,
      carbsG: targets.carbsG * d,
      fatG: targets.fatG * d,
    };
  }, [targets, weekly, weeklyAverage, range.days]);

  async function handleDelete(id: string) {
    try {
      await backend.remove(id);
      hapticNotify('success');
      onToast?.('success', 'Meal deleted');
      refresh();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not delete');
    }
  }

  async function handleAiDraft(id: string, revised: MealResult) {
    try {
      await backend.update(id, revised);
      hapticNotify('success');
      onToast?.('success', 'Meal updated with AI');
      refresh();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not update');
    }
  }

  // Divisor: 1 for a day/weekly-total, or the number of days for weekly-average.
  const div = weeklyAverage ? range.days : 1;
  const sum = (pick: (m: RecentMeal) => number | null) =>
    round1((meals?.reduce((s, m) => s + (pick(m) ?? 0), 0) ?? 0) / div);
  const consumed = {
    energyKcal: sum((m) => m.energyKcal),
    proteinG: sum((m) => m.proteinG),
    carbsG: sum((m) => m.carbsG),
    fatG: sum((m) => m.fatG),
  };

  const kcalLeft = viewTargets ? Math.round(viewTargets.energyKcal - consumed.energyKcal) : null;
  const kcalOver = kcalLeft != null && kcalLeft < 0;
  const hasMeals = (meals?.length ?? 0) > 0;
  // A verdict needs evidence: on an empty day "protein is short" is a statement
  // about the user, not about the data.
  const proteinShort =
    hasMeals && viewTargets != null && consumed.proteinG < viewTargets.proteinG * 0.8 && !kcalOver;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title">SnapBite</h1>
          {streak != null && (
            <p className="text-muted-foreground text-caption">🔥 {streak}-day streak</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            disabled={refreshing}
            onClick={manualRefresh}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add a meal by hand"
            onClick={() => setAddOpen(true)}
          >
            <Keyboard className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <DateSelector value={date} onChange={onDateChange} loggedDates={loggedDates} />
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && onViewChange(v as 'daily' | 'weekly')}
          block
          aria-label="View"
        >
          <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
          <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {viewTargets ? (
        <section
          aria-label="Today's progress"
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
        >
          <ProgressRing
            consumed={consumed.energyKcal}
            target={viewTargets.energyKcal}
            label={weeklyAverage ? 'kcal / day' : 'kcal'}
            size={132}
            hero
            colorClass="text-primary"
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-title leading-tight">
              {!hasMeals
                ? 'Nothing logged yet'
                : kcalOver
                  ? `Over by ${Math.abs(kcalLeft ?? 0)}`
                  : proteinShort
                    ? 'Protein is short'
                    : 'On track'}
            </p>
            {!hasMeals ? (
              <p className="text-muted-foreground text-caption">Tap the camera to add one.</p>
            ) : (
              weekly && (
                <p className="text-muted-foreground text-caption">
                  {weeklyAverage ? 'Daily average' : 'Week total'} · {range.label}
                </p>
              )
            )}

            <dl className="mt-3 flex flex-col gap-1.5">
              {[
                ['Protein', consumed.proteinG, viewTargets.proteinG, 'g'],
                ['Carbs', consumed.carbsG, viewTargets.carbsG, 'g'],
                ['Fat', consumed.fatG, viewTargets.fatG, 'g'],
              ].map(([label, have, target, unit]) => (
                <div key={String(label)} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground text-caption">{label}</dt>
                  <dd className="tabular text-caption font-medium">
                    {Math.round(Number(have))}
                    <span className="text-muted-foreground">
                      {' / '}
                      {Math.round(Number(target))}
                      {unit}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            {weekly && (
              <ToggleGroup
                type="single"
                value={weekViewMode}
                onValueChange={(v) => v && setWeekMode(v as WeekViewMode)}
                size="sm"
                className="mt-3"
                aria-label="Weekly total or average"
              >
                <ToggleGroupItem value="total">Total</ToggleGroupItem>
                <ToggleGroupItem value="average">Daily avg</ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </section>
      ) : (
        <section className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-body font-medium">Set a goal to see your rings</p>
            <p className="text-muted-foreground text-caption">Meals are logged either way.</p>
          </div>
          <Button size="sm" onClick={onSetGoal}>
            Set goal
          </Button>
        </section>
      )}

      {error && <p className="text-destructive text-caption">{error}</p>}

      {!viewTargets && meals && meals.length === 0 && (
        <p className="text-muted-foreground text-caption">
          Nothing logged yet — tap the camera to add one.
        </p>
      )}

      {!meals && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}


      {meals && meals.length > 0 && (
        <div className="flex flex-col gap-2">
          {meals.map((m) => (
            <SwipeableRow
              key={m.id}
              animateIn={newIds.has(m.id)}
              onDelete={() => void handleDelete(m.id)}
            >
              <Card className="overflow-hidden">
                <CardContent className="flex items-center gap-3 p-3">
                  {m.previewUrl ? (
                    <img
                      src={m.previewUrl}
                      alt=""
                      className="size-16 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="bg-muted size-16 shrink-0 rounded-md" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenMeal(m)}
                  >
                    <div className="truncate font-medium">{m.label}</div>
                    <div className="flex items-center gap-2">
                      <MacroLine energyKcal={m.energyKcal} compact />
                      {m.aiProvider && (
                        <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
                          {PROVIDER_LABEL[m.aiProvider] ?? m.aiProvider}
                        </span>
                      )}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Update with AI"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiMeal(m);
                    }}
                  >
                    <Sparkles className="text-primary size-4" />
                  </Button>
                </CardContent>
              </Card>
            </SwipeableRow>
          ))}
          <MacroLegend className="justify-center pt-1" />
        </div>
      )}

      <ManualMealDialog
        backend={backend}
        open={addOpen}
        onOpenChange={setAddOpen}
        onLogged={refresh}
        onToast={onToast}
      />

      {aiMeal && (
        <ReviseWithAiDialog
          open={aiMeal !== null}
          onOpenChange={(open) => {
            if (!open) setAiMeal(null);
          }}
          backend={backend}
          mealId={aiMeal.id}
          onDraft={(revised) => void handleAiDraft(aiMeal.id, revised)}
          {...(onToast ? { onToast } : {})}
        />
      )}
    </div>
  );
}
