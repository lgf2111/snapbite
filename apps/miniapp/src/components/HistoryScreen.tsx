import { useEffect, useState } from 'react';
import type { Backend, HistoryDay } from '../lib/backend.js';

interface HistoryScreenProps {
  backend: Backend;
  onOpenMeal: (id: string) => void;
}

/** History grouped by day, newest first, with a per-day kcal total. */
export function HistoryScreen({ backend, onOpenMeal }: HistoryScreenProps) {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .history()
      .then(setDays)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend]);

  if (error) return <p className="warn">{error}</p>;
  if (!days) return <p className="muted">Loading…</p>;
  if (days.length === 0) return <p className="muted">No meals logged yet.</p>;

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
            <button
              type="button"
              className="card saved-item"
              key={m.id}
              onClick={() => onOpenMeal(m.id)}
              style={{ marginBottom: 8, width: '100%', textAlign: 'left', cursor: 'pointer' }}
            >
              {m.previewUrl && <img src={m.previewUrl} alt="" />}
              <div>
                <div className="food-name">{m.label}</div>
                <div className="macro">{m.energyKcal ?? '—'} kcal</div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
