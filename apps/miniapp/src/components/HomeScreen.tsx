import { Camera } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Backend, RecentMeal } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import { DateSelector } from './DateSelector.js';
import { MacroLine } from './MacroLine.js';
import { SwipeableRow } from './SwipeableRow.js';
import { UpdateWithAi } from './UpdateWithAi.js';

type ToastKind = 'success' | 'error' | 'info';

interface HomeScreenProps {
  backend: Backend;
  onOpenMeal: (id: string) => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

/** Local YYYY-MM-DD for "today". */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Home is a day view: pick a date at the top, see that day's total + the meals
 * logged that day. Each meal supports swipe-to-delete and "Update with AI".
 */
export function HomeScreen({ backend, onOpenMeal, onToast }: HomeScreenProps) {
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

  const totalKcal =
    meals?.reduce((s, m) => s + (m.energyKcal ?? 0), 0) ?? 0;
  const roundedKcal = Math.round(totalKcal * 10) / 10;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">FoodLog</h1>
      </div>

      <DateSelector value={date} onChange={setDate} loggedDates={loggedDates} />

      <Card>
        <CardContent className="flex justify-around text-center">
          <div>
            <div className="text-2xl font-bold">{roundedKcal}</div>
            <div className="text-muted-foreground text-xs">kcal</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{meals?.length ?? 0}</div>
            <div className="text-muted-foreground text-xs">
              {meals?.length === 1 ? 'meal' : 'meals'}
            </div>
          </div>
        </CardContent>
      </Card>

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
                  <UpdateWithAi
                    backend={backend}
                    mealId={m.id}
                    variant="icon"
                    onDone={refresh}
                    {...(onToast ? { onToast } : {})}
                  />
                </CardContent>
              </Card>
            </SwipeableRow>
          ))}
        </div>
      )}
    </div>
  );
}
