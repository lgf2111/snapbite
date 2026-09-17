import type { DailyTargets } from '@foodlog/core';
import { Camera, Sparkles, Target } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Backend, RecentMeal } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import { DateSelector } from './DateSelector.js';
import { MacroLine } from './MacroLine.js';
import { ProgressRing } from './ProgressRing.js';
import { SwipeableRow } from './SwipeableRow.js';

type ToastKind = 'success' | 'error' | 'info';

interface HomeScreenProps {
  backend: Backend;
  targets: DailyTargets | null;
  onOpenMeal: (id: string) => void;
  onOpenMealWithAi: (id: string) => void;
  onSetGoal: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

/** Local YYYY-MM-DD for "today". */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
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
  onOpenMeal,
  onOpenMealWithAi,
  onSetGoal,
  onToast,
}: HomeScreenProps) {
  const [date, setDate] = useState(todayKey());
  const [meals, setMeals] = useState<RecentMeal[] | null>(null);
  const [loggedDates, setLoggedDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadDates = useCallback(() => {
    backend
      .mealDates()
      .then(setLoggedDates)
      .catch(() => setLoggedDates([]));
  }, [backend]);

  const loadDay = useCallback(
    (d: string) => {
      setMeals(null);
      setError(null);
      backend
        .mealsByDate(d)
        .then(setMeals)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
    },
    [backend],
  );

  useEffect(() => loadDay(date), [loadDay, date]);
  useEffect(loadDates, [loadDates]);

  const refresh = () => {
    loadDay(date);
    loadDates();
  };

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
        <h1 className="text-xl font-semibold">FoodLog</h1>
      </div>

      <DateSelector value={date} onChange={setDate} loggedDates={loggedDates} />

      {targets ? (
        <Card>
          <CardContent className="grid grid-cols-4 place-items-center gap-2">
            <ProgressRing
              consumed={consumed.energyKcal}
              target={targets.energyKcal}
              label="kcal"
              icon="🔥"
              size={84}
              colorClass="text-primary"
            />
            <ProgressRing
              consumed={consumed.proteinG}
              target={targets.proteinG}
              label="protein"
              icon="🥩"
              size={72}
              colorClass="text-rose-500"
            />
            <ProgressRing
              consumed={consumed.carbsG}
              target={targets.carbsG}
              label="carbs"
              icon="🍚"
              size={72}
              colorClass="text-amber-500"
            />
            <ProgressRing
              consumed={consumed.fatG}
              target={targets.fatG}
              label="fat"
              icon="🧈"
              size={72}
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
            <p className="font-medium">No meals this day</p>
            <p className="text-muted-foreground text-sm">
              Send a photo to the bot to log a meal — it's analyzed and logged automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {meals && meals.length > 0 && (
        <div className="flex flex-col gap-2">
          {meals.map((m) => (
            <SwipeableRow key={m.id} onDelete={() => void handleDelete(m.id)}>
              <Card className="bg-background">
                <CardContent className="flex items-center gap-3">
                  {m.previewUrl && (
                    <img src={m.previewUrl} alt="" className="size-12 rounded-md object-cover" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenMeal(m.id)}
                  >
                    <div className="truncate font-medium">{m.label}</div>
                    <MacroLine energyKcal={m.energyKcal} compact />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Update with AI"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMealWithAi(m.id);
                    }}
                  >
                    <Sparkles className="text-primary size-4" />
                  </Button>
                </CardContent>
              </Card>
            </SwipeableRow>
          ))}
        </div>
      )}
    </div>
  );
}
