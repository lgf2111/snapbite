import { aggregate, type MealResult, resolveFoodNutrition, sourceLabel } from '@foodlog/core';
import { useMemo, useState } from 'react';

interface ConfirmScreenProps {
  initial: MealResult;
  previewUrl?: string;
  onSave: (meal: MealResult) => void;
  onRetake: () => void;
}

/**
 * Editable confirmation screen. The user can correct each food's name and
 * weight; nutrition re-resolves live and the total re-aggregates. Every value
 * is clearly labeled as an estimate.
 */
export function ConfirmScreen({ initial, previewUrl, onSave, onRetake }: ConfirmScreenProps) {
  const [foods, setFoods] = useState(() => initial.foods.map((f) => ({ ...f.food })));

  // Re-resolve nutrition whenever the edited foods change.
  const resolved = useMemo(() => {
    const mealFoods = foods.map((food) => ({
      food,
      nutrition:
        resolveFoodNutrition(food) ??
        ({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, source: 'ai_estimate' } as const),
    }));
    const total = aggregate(mealFoods.map((f) => f.nutrition));
    return { foods: mealFoods, total };
  }, [foods]);

  function updateFood(index: number, patch: Partial<(typeof foods)[number]>) {
    setFoods((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function handleSave() {
    const meal: MealResult = {
      foods: resolved.foods,
      total: resolved.total,
      confidence: initial.confidence,
      needsConfirmation: initial.needsConfirmation,
      ...(initial.notes !== undefined ? { notes: initial.notes } : {}),
    };
    onSave(meal);
  }

  return (
    <div>
      <div className="header">
        <h1>Confirm meal</h1>
        <span className="estimate-badge">AI estimate</span>
      </div>

      {previewUrl && <img className="preview" src={previewUrl} alt="Captured meal" />}

      {initial.needsConfirmation && (
        <p className="warn">⚠ Low confidence — please review the items below.</p>
      )}

      <div className="card">
        {resolved.foods.map((mf, i) => (
          <div className="food-row" key={i}>
            <div>
              <input
                aria-label={`Food ${i + 1} name`}
                className="food-name"
                value={mf.food.name}
                onChange={(e) => updateFood(i, { name: e.target.value })}
              />
              <div className="macro">
                {mf.nutrition.energyKcal} kcal · P {mf.nutrition.proteinG}g · C{' '}
                {mf.nutrition.carbsG}g · F {mf.nutrition.fatG}g{' '}
                <span className="source-tag">[{sourceLabel(mf.nutrition.source)}]</span>
              </div>
            </div>
            <div>
              <input
                aria-label={`Food ${i + 1} weight in grams`}
                type="number"
                min={1}
                value={mf.food.estimatedWeightG}
                onChange={(e) =>
                  updateFood(i, { estimatedWeightG: Math.max(1, Number(e.target.value) || 1) })
                }
                style={{ width: 80 }}
              />
              <span className="muted"> g</span>
            </div>
          </div>
        ))}

        <div className="total">
          <span>Total (estimate)</span>
          <span>
            {resolved.total.energyKcal} kcal{' '}
            <span className="source-tag">[{sourceLabel(resolved.total.source)}]</span>
          </span>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="btn secondary full" onClick={onRetake}>
          Retake
        </button>
        <button type="button" className="btn full" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
