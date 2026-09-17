import { useCallback, useEffect, useState } from 'react';
import type { Backend, HistoryDay } from '../lib/backend.js';
import { hapticNotify } from '../lib/telegram.js';
import { MacroLine } from './MacroLine.js';
import { SwipeableRow } from './SwipeableRow.js';

type ToastKind = 'success' | 'error' | 'info';

interface HistoryScreenProps {
  backend: Backend;
  onOpenMeal: (id: string) => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

/** History grouped by day, newest first, with a per-day kcal total. */
export function HistoryScreen({ backend, onOpenMeal, onToast }: HistoryScreenProps) {
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
      load();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not delete');
    }
  }

  if (error) return <p className="warn">{error}</p>;
  if (!days) return <SkeletonList />;
  if (days.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🍽️</div>
        <p className="food-name">No meals logged yet</p>
        <p className="muted">Send a photo to the bot to log your first meal.</p>
      </div>
    );
  }

  return (
    <div>
      {days.map((day) => (
        <div key={day.date} style={{ marginBottom: 16 }}>
          <div className="header">
            <p className="muted" style={{ margin: 0 }}>
              {day.date}
            </p>
            <span className="muted">{day.totalKcal} kcal</span>
          </div>
          {day.meals.map((m) => (
            <SwipeableRow key={m.id} onDelete={() => void handleDelete(m.id)}>
              <button
                type="button"
                className="card saved-item"
                onClick={() => onOpenMeal(m.id)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
              >
                {m.previewUrl && <img src={m.previewUrl} alt="" />}
                <div>
                  <div className="food-name">{m.label}</div>
                  <MacroLine energyKcal={m.energyKcal} compact />
                </div>
              </button>
            </SwipeableRow>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Simple shimmer placeholder while history loads. */
function SkeletonList() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div className="card skeleton-row" key={i}>
          <div className="skeleton skeleton-line" style={{ width: '60%' }} />
          <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        </div>
      ))}
    </div>
  );
}
