import { UtensilsCrossed } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Backend, HistoryDay } from '@/lib/backend';
import { hapticNotify } from '@/lib/telegram';
import { MacroLine } from './MacroLine.js';
import { SwipeableRow } from './SwipeableRow.js';

type ToastKind = 'success' | 'error' | 'info';

interface HistoryScreenProps {
  backend: Backend;
  onOpenMeal: (id: string) => void;
  onToast?: (kind: ToastKind, message: string) => void;
  onChanged?: () => void;
}

/** History grouped by day, newest first, with swipe-to-delete on each meal. */
export function HistoryScreen({ backend, onOpenMeal, onToast, onChanged }: HistoryScreenProps) {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    backend
      .history()
      .then(setDays)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend]);

  useEffect(() => load(), [load]);

  async function handleDelete(id: string) {
    try {
      await backend.remove(id);
      hapticNotify('success');
      onToast?.('success', 'Meal deleted');
      onChanged?.();
      load();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not delete');
    }
  }

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!days) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (days.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
        <UtensilsCrossed className="size-10" />
        <p className="text-foreground font-medium">No meals logged yet</p>
        <p>Send a photo to the bot to log your first meal.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">History</h1>
      {days.map((day) => (
        <div key={day.date} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">{day.date}</p>
            <span className="text-muted-foreground text-sm">{day.totalKcal} kcal</span>
          </div>
          {day.meals.map((m) => (
            <SwipeableRow key={m.id} onDelete={() => void handleDelete(m.id)}>
              <Card onClick={() => onOpenMeal(m.id)} className="cursor-pointer">
                <CardContent className="flex items-center gap-3">
                  {m.previewUrl && (
                    <img src={m.previewUrl} alt="" className="size-12 rounded-md object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.label}</div>
                    <MacroLine energyKcal={m.energyKcal} compact />
                  </div>
                </CardContent>
              </Card>
            </SwipeableRow>
          ))}
        </div>
      ))}
    </div>
  );
}
