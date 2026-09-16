import { useEffect, useState } from 'react';
import type { MealDetail } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';

interface MealDetailScreenProps {
  backend: Backend;
  mealId: string;
  onBack: () => void;
}

/** Full detail of a single logged meal (read-only), always framed as an estimate. */
export function MealDetailScreen({ backend, mealId, onBack }: MealDetailScreenProps) {
  const [detail, setDetail] = useState<MealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .detail(mealId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend, mealId]);

  return (
    <div>
      <div className="header">
        <h1>Meal</h1>
        <span className="estimate-badge">estimate</span>
      </div>

      {error && <p className="warn">{error}</p>}
      {!detail && !error && <p className="muted">Loading…</p>}

      {detail && (
        <>
          <p className="muted">{new Date(detail.loggedAt).toLocaleString()}</p>
          <div className="card">
            {detail.foods.map((f) => (
              <div className="food-row" key={f.id}>
                <div>
                  <div className="food-name">{f.name}</div>
                  <div className="macro">
                    ~{(f.estimatedWeightG ?? 0) * f.quantity}g
                    {f.portion ? ` · ${f.portion}` : ''}
                  </div>
                </div>
              </div>
            ))}
            {detail.total && (
              <div className="total">
                <span>Total (estimate)</span>
                <span>
                  {detail.total.energyKcal} kcal · P {detail.total.proteinG}g · C{' '}
                  {detail.total.carbsG}g · F {detail.total.fatG}g
                </span>
              </div>
            )}
          </div>
          {detail.notes && <p className="muted">Notes: {detail.notes}</p>}
        </>
      )}

      <button type="button" className="btn secondary full" onClick={onBack} style={{ marginTop: 16 }}>
        Back
      </button>
    </div>
  );
}
