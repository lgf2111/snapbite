import { type DailyTargets, PROVIDER_PRESETS } from '@snapbite/core';
import { Camera, Plus, Sparkles, Target } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cacheKey } from '@/lib/cache';
import type { Backend, RecentMeal } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import { useCachedData } from '@/lib/useCachedData';
import { cn } from '@/lib/utils';
import { loadWeekPrefs, weekRange } from '@/lib/weekPrefs';
import { DateSelector } from './DateSelector.js';
import { ManualMealDialog } from './ManualMealDialog.js';
import { MacroLegend, MacroLine } from './MacroLine.js';
import { ProgressRing } from './ProgressRing.js';
import { SwipeableRow } from './SwipeableRow.js';

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
  onOpenMealWithAi: (meal: RecentMeal) => void;
  onSetGoal: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Home is a day view: pick a date at the top, see that day's targets (as
 * progress rings when a goal is set) and the meals logged that day. Each meal
 * supports swipe-to-delete and "Update with AI".
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
  onOpenMealWithAi,
  onSetGoal,
  onToast,
}: HomeScreenProps) {
  const [addOpen, setAddOpen] = useState(false);

  // Week definition preference (rolling vs calendar Sun/Mon) from Settings.
  const weekPrefs = useMemo(() => loadWeekPrefs(), []);
  const range = useMemo(() => weekRange(date, weekPrefs), [date, weekPrefs]);

  // Meals for the current view, served instantly from cache then revalidated.
  const mealsKey =
    view === 'weekly' ? cacheKey.mealsRange(range.startKey, range.endKey) : cacheKey.mealsByDate(date);
  const {
    data: mealsData,
    loading: mealsLoading,
    error,
    refresh: refreshMeals,
  } = useCachedData<RecentMeal[]>(mealsKey, () =>
    view === 'weekly' ? backend.mealsInRange(range.startKey, range.endKey) : backend.mealsByDate(date),
  );
  const meals = mealsLoading ? null : (mealsData ?? []);

  // Logged days for the calendar dots (cached).
  const { data: loggedDatesData, refresh: refreshDates } = useCachedData<string[]>(
    cacheKey.mealDates(),
    () => backend.mealDates(),
  );
  const loggedDates = loggedDatesData ?? [];

  const refresh = useCallback(() => {
    refreshMeals();
    refreshDates();
  }, [refreshMeals, refreshDates]);

  // App bumps refreshSignal after an edit/delete; revalidate without remounting
  // (so the selected day/view is preserved). Skip the initial mount.
  const firstSignal = useRef(refreshSignal);
  useEffect(() => {
    if (firstSignal.current === refreshSignal) return;
    firstSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  // Track which meal ids we've already shown for the CURRENT list key, so a
  // meal that appears later (after logging) animates in — but the initial batch
  // (and a day/view switch) does not animate everything.
  const seenIds = useRef<{ key: string; ids: Set<string> }>({ key: mealsKey, ids: new Set() });
  const newIds = useMemo(() => {
    const list = mealsData ?? [];
    const store = seenIds.current;
    if (store.key !== mealsKey) {
      // New day/view: treat everything as already-seen (no mass animation).
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
  // Weekly targets scale the daily target by the number of days in the range.
  const viewTargets = useMemo(() => {
    if (!targets) return null;
    if (!weekly) return targets;
    const d = range.days;
    return {
      energyKcal: targets.energyKcal * d,
      proteinG: targets.proteinG * d,
      carbsG: targets.carbsG * d,
      fatG: targets.fatG * d,
    };
  }, [targets, weekly, range.days]);

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

  const consumed = {
    energyKcal: round1(meals?.reduce((s, m) => s + (m.energyKcal ?? 0), 0) ?? 0),
    proteinG: round1(meals?.reduce((s, m) => s + (m.proteinG ?? 0), 0) ?? 0),
    carbsG: round1(meals?.reduce((s, m) => s + (m.carbsG ?? 0), 0) ?? 0),
    fatG: round1(meals?.reduce((s, m) => s + (m.fatG ?? 0), 0) ?? 0),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">SnapBite</h1>
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add meal
        </Button>
      </div>

      {/* Daily / Weekly view toggle. */}
      <div className="bg-muted flex gap-1 rounded-md p-1">
        {(['daily', 'weekly'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={cn(
              'flex-1 rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors',
              view === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <DateSelector value={date} onChange={onDateChange} loggedDates={loggedDates} />

      {weekly && (
        <p className="text-muted-foreground -mt-1 text-center text-xs">
          Week total · {range.label}
        </p>
      )}

      {viewTargets ? (
        <Card>
          <CardContent
            className="place-items-center gap-x-2 gap-y-4"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}
          >
            <ProgressRing
              consumed={consumed.energyKcal}
              target={viewTargets.energyKcal}
              label="kcal"
              icon="🔥"
              size={76}
              colorClass="text-primary"
            />
            <ProgressRing
              consumed={consumed.proteinG}
              target={viewTargets.proteinG}
              label="protein"
              icon="🥩"
              size={76}
              colorClass="text-rose-500"
            />
            <ProgressRing
              consumed={consumed.carbsG}
              target={viewTargets.carbsG}
              label="carbs"
              icon="🍚"
              size={76}
              colorClass="text-amber-500"
            />
            <ProgressRing
              consumed={consumed.fatG}
              target={viewTargets.fatG}
              label="fat"
              icon="🧈"
              size={76}
              colorClass="text-sky-500"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Target className="text-primary size-8" />
            <p className="font-medium">Set your goal to see daily targets</p>
            <p className="text-muted-foreground text-sm">
              Add your details and goal to track calories, protein, carbs, and fat left for the day.
            </p>
            <Button className="mt-1" onClick={onSetGoal}>
              Set your goal
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!meals && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {meals && meals.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Camera className="text-primary size-9" />
            <p className="font-medium">{weekly ? 'No meals this week' : 'No meals this day'}</p>
            <p className="text-muted-foreground text-sm">
              Send a photo to the bot to log a meal automatically, or tap <strong>Add meal</strong>{' '}
              to enter one by hand.
            </p>
            <Button variant="secondary" className="mt-1 gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add meal
            </Button>
          </CardContent>
        </Card>
      )}

      {meals && meals.length > 0 && (
        <div className="flex flex-col">
          {meals.map((m) => (
            <SwipeableRow
              key={m.id}
              animateIn={newIds.has(m.id)}
              onDelete={() => void handleDelete(m.id)}
            >
              <Card className="bg-background">
                <CardContent className="flex items-center gap-3">
                  {m.previewUrl && (
                    <img src={m.previewUrl} alt="" className="size-12 rounded-md object-cover" />
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
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                          {PROVIDER_LABEL[m.aiProvider] ?? m.aiProvider}
                        </span>
                      )}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Update with AI"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMealWithAi(m);
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
    </div>
  );
}
