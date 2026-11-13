import { Button } from '@/components/ui/button';
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
import type { DailyTargets, MealResult } from '@snapbite/core';
import { ChevronRight, Flame, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DateSelector } from './DateSelector.js';
import { InstallGuide } from './InstallGuide.js';
import { MacroRow, type MacroTone } from './MacroRow.js';
import { MealRow } from './MealRow.js';
import { ProgressRing } from './ProgressRing.js';
import { ReviseWithAiDialog } from './UpdateWithAi.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';

type ToastKind = 'success' | 'error' | 'info';

/** The undo window after a swipe-delete; the removal is committed when it ends. */
const UNDO_MS = 6000;

/** The one pointer to the camera, used by both the progress and no-goal blocks. */
const CAMERA_CUE = 'Tap the camera to add one.';

/** Shown when the backend gave no message of its own. */
const LOAD_ERROR = "Couldn't load meals. Tap Refresh to try again.";

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
  onOpenReports: () => void;
  onSetGoal: () => void;
  /** Setup is covering Home: the install tip must not render behind it. */
  hideInstallGuide?: boolean;
  onToast?: (kind: ToastKind, message: string) => void;
  /** One-line credit trace when a BYOK call overflowed onto our key. */
  creditNotice?: string | null;
  onCreditNotice?: (notice: string) => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Consumed as a share of the target; a missing target reads as zero. */
const macroRatio = (have: number, target: number) => (target > 0 ? Math.max(0, have / target) : 0);

/**
 * Macro state by share of target: the brand fill while at or under target,
 * `--warning` once over, and `--destructive` once more than 20% over. The
 * value text carries a `+` as well, so the state is never only a hue.
 */
const macroTone = (have: number, target: number): MacroTone => {
  const ratio = macroRatio(have, target);
  if (ratio > 1.2) return 'destructive';
  if (ratio > 1) return 'warning';
  return 'primary';
};

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
  onOpenReports,
  onSetGoal,
  hideInstallGuide = false,
  onToast,
  creditNotice = null,
  onCreditNotice,
}: HomeScreenProps) {
  const [refreshing, setRefreshing] = useState(false);
  /** The meal being edited with AI inline from Home (null = dialog closed). */
  const [aiMeal, setAiMeal] = useState<RecentMeal | null>(null);
  const [streakOpen, setStreakOpen] = useState(false);
  /** Rows hidden immediately on swipe-delete, while their undo toast is live. */
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Deletions waiting out their undo window: id → its timer and toast. */
  const pendingDeletes = useRef(new Map<string, { timer: number; toastId: string | number }>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Leaving Home commits what is still pending: an undo offer must not
      // outlive the row it would restore.
      for (const [id, pending] of pendingDeletes.current) {
        window.clearTimeout(pending.timer);
        toast.dismiss(pending.toastId);
        void backend.remove(id).catch(() => undefined);
      }
      pendingDeletes.current.clear();
    };
  }, [backend]);

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
  } = useCachedData<RecentMeal[]>(
    mealsKey,
    () =>
      view === 'weekly'
        ? backend.mealsInRange(range.startKey, range.endKey)
        : backend.mealsByDate(date),
    LOAD_ERROR,
  );
  // Hidden rows are deleted optimistically: totals, verdict and the list all stop
  // counting the meal during the undo window, and Undo puts it straight back.
  // A background revalidate may replace `mealsData`, but it never clears the
  // list: only a first load with no cached value has no rows to show.
  const meals = useMemo(
    () => (mealsData ?? []).filter((m) => !hiddenIds.has(m.id)),
    [mealsData, hiddenIds],
  );

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
    // Say it out loud: the spinner is small, and a press that produces no visible
    // change reads as a broken button. The list updates in place, so the toast is
    // the only confirmation that anything happened.
    onToast?.('success', 'Refreshed');
    window.setTimeout(() => setRefreshing(false), 700);
  }, [refresh, refreshing, onToast]);

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

  /** Put a swipe-deleted row back, before its deletion has been committed. */
  function undoDelete(id: string) {
    const pending = pendingDeletes.current.get(id);
    if (!pending) return;
    pendingDeletes.current.delete(id);
    window.clearTimeout(pending.timer);
    toast.dismiss(pending.toastId);
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** Commit one pending deletion. A failure puts the row back. */
  async function commitDelete(id: string) {
    const pending = pendingDeletes.current.get(id);
    if (!pending) return;
    pendingDeletes.current.delete(id);
    window.clearTimeout(pending.timer);
    try {
      await backend.remove(id);
      toast.dismiss(pending.toastId);
      hapticNotify('success');
      if (alive.current) {
        // The backend drops the id from every cached meal list. Keep the row
        // hidden and revalidate only the date dots: refetching the day here is
        // what flashed the list through an empty loading state.
        refreshDates();
      }
    } catch (e) {
      if (!alive.current) return;
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onToast?.('error', e instanceof Error ? e.message : 'Could not delete');
    }
  }

  /**
   * A swipe-delete is immediate on screen but not on the server: the row hides,
   * and a single toast offers Undo for a few seconds. Dismissing the toast or
   * letting it time out commits the deletion; Undo cancels it, so nothing was
   * ever lost.
   */
  function handleDelete(meal: RecentMeal) {
    setHiddenIds((prev) => new Set(prev).add(meal.id));
    const toastId = toast('Meal deleted', {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undoDelete(meal.id) },
      onDismiss: () => {
        if (pendingDeletes.current.has(meal.id)) void commitDelete(meal.id);
      },
      onAutoClose: () => {
        if (pendingDeletes.current.has(meal.id)) void commitDelete(meal.id);
      },
    });
    const timer = window.setTimeout(() => void commitDelete(meal.id), UNDO_MS);
    pendingDeletes.current.set(meal.id, { timer, toastId });
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
    round1(meals.reduce((s, m) => s + (pick(m) ?? 0), 0) / div);
  const consumed = {
    energyKcal: sum((m) => m.energyKcal),
    proteinG: sum((m) => m.proteinG),
    carbsG: sum((m) => m.carbsG),
    fatG: sum((m) => m.fatG),
  };

  const kcalLeft = viewTargets ? Math.round(viewTargets.energyKcal - consumed.energyKcal) : null;
  const kcalOver = kcalLeft != null && kcalLeft < 0;
  const hasMeals = meals.length > 0;
  // A verdict needs evidence: on an empty day "protein is short" is a statement
  // about the user, not about the data.
  const proteinShort =
    hasMeals && viewTargets != null && consumed.proteinG < viewTargets.proteinG * 0.8 && !kcalOver;

  // First load with nothing cached: the ring is empty and the verdict stays blank,
  // because "Nothing logged yet" would be a claim about data that has not arrived.
  const settled = mealsData !== undefined;

  return (
    <div className="flex flex-col gap-5">
      <DateSelector
        value={date}
        onChange={onDateChange}
        loggedDates={loggedDates}
        {...(weekly ? { label: range.label } : {})}
      />

      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && onViewChange(v as 'daily' | 'weekly')}
          className="min-w-0 flex-1"
          aria-label="View"
        >
          <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
          <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
        </ToggleGroup>
        {streak != null && streak > 0 && (
          <button
            type="button"
            onClick={() => setStreakOpen(true)}
            className="bg-secondary text-foreground text-caption inline-flex min-h-11 shrink-0 items-center gap-1 rounded-control px-3 font-medium transition-transform duration-[120ms] hover:bg-accent active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Flame data-testid="streak-flame" className="size-4 stroke-[1.75]" aria-hidden />
            <span className="tabular">{streak}</span>
            <span className="sr-only"> day streak</span>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={manualRefresh}
          className="shrink-0"
        >
          <RefreshCw
            className={cn('size-4', refreshing && 'animate-spin motion-reduce:animate-none')}
          />
        </Button>
      </div>

      {!hideInstallGuide && <InstallGuide />}

      {viewTargets ? (
        <section aria-label="Progress" className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <ProgressRing
              consumed={consumed.energyKcal}
              target={viewTargets.energyKcal}
              label={weeklyAverage ? 'kcal / day' : 'kcal'}
              size={132}
              hero
              colorClass="text-primary"
            />
            <div className="min-w-[11rem] flex-1">
              {settled && (
                <p className="font-display text-title font-normal">
                  {!hasMeals
                    ? 'Nothing logged yet'
                    : kcalOver
                      ? `Over by ${Math.abs(kcalLeft ?? 0)}\u00a0kcal`
                      : proteinShort
                        ? 'Protein is short'
                        : 'On track'}
                </p>
              )}
              {settled && !hasMeals ? (
                <p className="text-muted-foreground text-caption">{CAMERA_CUE}</p>
              ) : (
                weekly &&
                settled && (
                  <p className="text-muted-foreground text-caption">
                    {weeklyAverage ? 'Daily average' : 'Week total'}
                  </p>
                )
              )}

              <dl className="mt-3 flex flex-col gap-3">
                {(
                  [
                    ['protein', consumed.proteinG, viewTargets.proteinG],
                    ['carbs', consumed.carbsG, viewTargets.carbsG],
                    ['fat', consumed.fatG, viewTargets.fatG],
                  ] as const
                ).map(([macro, have, target]) => (
                  <MacroRow
                    key={macro}
                    macro={macro}
                    have={have}
                    target={target}
                    unit="g"
                    tone={macroTone(have, target)}
                  />
                ))}
              </dl>
            </div>
          </div>

          {/* Its own full-width row under the ring and the macros; beside the ring
              column it was squeezed and its second label clipped. Weekly only. */}
          {weekly && (
            <ToggleGroup
              type="single"
              value={weekViewMode}
              onValueChange={(v) => v && setWeekMode(v as WeekViewMode)}
              size="sm"
              block
              aria-label="Weekly total or average"
            >
              <ToggleGroupItem value="total">Total</ToggleGroupItem>
              <ToggleGroupItem value="average">Daily avg</ToggleGroupItem>
            </ToggleGroup>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div>
            <p className="text-body font-medium">Set a goal to see today&rsquo;s progress</p>
            {meals.length === 0 && (
              <p className="text-muted-foreground text-caption">{CAMERA_CUE}</p>
            )}
            {meals.length > 0 && (
              <p className="text-muted-foreground text-caption">
                Set a goal later. Meals log without one.
              </p>
            )}
          </div>
          <Button className="w-full" onClick={onSetGoal}>
            Set goal
          </Button>
        </section>
      )}

      {/* One row, always visible: Reports is where the log is read across time.
          Whether this account can open it is the Worker's call (403 → locked). */}
      <button
        type="button"
        onClick={onOpenReports}
        className="flex min-h-14 w-full items-center justify-between gap-3 border-y border-border text-left transition-transform duration-[120ms] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="text-body font-medium">Reports</span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </button>

      {creditNotice && (
        <output className="text-muted-foreground text-caption block">{creditNotice}</output>
      )}

      {error && (
        <p role="alert" className="text-destructive text-caption">
          {error}
        </p>
      )}

      {mealsLoading && mealsData === undefined && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-control" />
          ))}
        </div>
      )}

      {meals.length > 0 && (
        <section>
          <h2 className="sr-only">Meals</h2>
          <div className="divide-border flex flex-col divide-y">
            {meals.map((m) => (
              <MealRow
                key={m.id}
                meal={m}
                isNew={newIds.has(m.id)}
                onOpen={onOpenMeal}
                onDelete={handleDelete}
                onAi={setAiMeal}
              />
            ))}
          </div>
        </section>
      )}

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
          {...(onCreditNotice ? { onCreditNotice } : {})}
        />
      )}

      <Dialog open={streakOpen} onOpenChange={setStreakOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logging streak</DialogTitle>
            <DialogDescription>A day counts when you log at least one meal.</DialogDescription>
          </DialogHeader>
          <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-4 text-caption">
            <li>
              Today or yesterday keeps the run alive, so logging in the evening never breaks it.
            </li>
            <li>A whole day with no meals ends the streak.</li>
            <li>Miss a day and your next log within the week can revive it, once every 30 days.</li>
          </ul>
          <DialogFooter>
            <Button onClick={() => setStreakOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
