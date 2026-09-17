import {
  aggregate,
  type FoodItem,
  type MealResult,
  resolveFoodNutrition,
  sourceLabel,
} from '@foodlog/core';
import { useEffect, useMemo, useState } from 'react';
import type { MealDetail } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';
import { hapticImpact } from '../lib/telegram.js';
import { useBackButton, useMainButton } from '../lib/useTelegramButtons.js';
import { MacroLine } from './MacroLine.js';

type ToastKind = 'success' | 'error' | 'info';

interface MealDetailScreenProps {
  backend: Backend;
  onToast?: (kind: ToastKind, message: string) => void;
  mealId: string;
  onBack: () => void;
  onChanged: () => void;
}

/** Editable, deletable detail of a single logged meal. */
export function MealDetailScreen({
  backend,
  mealId,
  onBack,
  onChanged,
  onToast,
}: MealDetailScreenProps) {
  const [detail, setDetail] = useState<MealDetail | null>(null);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    backend
      .detail(mealId)
      .then((d) => {
        setDetail(d);
        setFoods(
          d.foods.map((f) => ({
            name: f.name,
            estimatedWeightG: f.estimatedWeightG ?? 1,
            portion: f.portion ?? undefined,
            quantity: f.quantity,
            confidence: f.confidence ?? 0.5,
            // Seed the stored per-food nutrition so every food shows its real
            // macros on load (not just table-matched ones). Kept as a manual
            // override so it survives re-render without re-resolving from name.
            ...(f.energyKcal != null
              ? {
                  manualNutrition: {
                    energyKcal: f.energyKcal,
                    proteinG: f.proteinG ?? 0,
                    carbsG: f.carbsG ?? 0,
                    fatG: f.fatG ?? 0,
                  },
                }
              : {}),
          })),
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend, mealId]);

  const resolved = useMemo(() => {
    const mealFoods = foods.map((food) => ({
      food,
      nutrition:
        resolveFoodNutrition(food) ??
        ({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, source: 'ai_estimate' } as const),
    }));
    return { foods: mealFoods, total: aggregate(mealFoods.map((f) => f.nutrition)) };
  }, [foods]);

  function updateFood(i: number, patch: Partial<FoodItem>) {
    setFoods((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeFood(i: number) {
    setFoods((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** Sets a manual macro override for a food, seeding from current resolved values. */
  function setMacro(i: number, key: 'energyKcal' | 'proteinG' | 'carbsG' | 'fatG', value: number) {
    setFoods((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const current = f.manualNutrition ??
          resolveFoodNutrition(f) ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
        return {
          ...f,
          manualNutrition: {
            energyKcal: current.energyKcal,
            proteinG: current.proteinG,
            carbsG: current.carbsG,
            fatG: current.fatG,
            [key]: Math.max(0, value),
          },
        };
      }),
    );
  }

  async function handleSave() {
    if (!detail || foods.length === 0) return;
    setBusy('saving');
    setError(null);
    const meal: MealResult = {
      foods: resolved.foods,
      total: resolved.total,
      confidence: detail.confidence ?? 0.5,
      needsConfirmation: false,
      ...(detail.notes ? { notes: detail.notes } : {}),
    };
    try {
      await backend.update(mealId, meal);
      onChanged();
      onToast?.('success', 'Meal updated');
      onBack();
    } catch (e) {
      setBusy(null);
      const msg = e instanceof Error ? e.message : 'Could not save';
      setError(msg);
      onToast?.('error', msg);
    }
  }

  async function handleDelete() {
    setBusy('deleting');
    setError(null);
    try {
      await backend.remove(mealId);
      onChanged();
      onToast?.('success', 'Meal deleted');
      onBack();
    } catch (e) {
      setBusy(null);
      const msg = e instanceof Error ? e.message : 'Could not delete';
      setError(msg);
      onToast?.('error', msg);
    }
  }

  function requestDelete() {
    hapticImpact('medium');
    setConfirmDelete(true);
  }

  // Native Telegram back button returns to the list; while a delete dialog is
  // open, back cancels it instead.
  useBackButton(true, () => {
    if (confirmDelete) setConfirmDelete(false);
    else onBack();
  });

  // Native Telegram main button drives Save; falls back to the in-page button
  // when not running in Telegram.
  const nativeSave = useMainButton(detail !== null && !confirmDelete, {
    text: busy === 'saving' ? 'Saving…' : 'Save changes',
    onClick: () => void handleSave(),
    enabled: busy === null && foods.length > 0,
    loading: busy === 'saving',
  });

  return (
    <div>
      <div className="header">
        <h1>Edit meal</h1>
      </div>

      {error && <p className="warn">{error}</p>}
      {!detail && !error && <p className="muted">Loading…</p>}

      {detail && (
        <>
          <p className="muted">{new Date(detail.loggedAt).toLocaleString()}</p>
          {detail.telegramFileId && backend.photoUrl(mealId) && (
            <img className="preview" src={backend.photoUrl(mealId) as string} alt="Meal" />
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
                  <div className="macro-edit">
                    <label title="calories">
                      🔥
                      <input
                        aria-label={`Food ${i + 1} kcal`}
                        type="number"
                        min={0}
                        value={mf.nutrition.energyKcal}
                        onChange={(e) => setMacro(i, 'energyKcal', Number(e.target.value) || 0)}
                      />
                      kcal
                    </label>
                    <label title="protein">
                      🥩
                      <input
                        aria-label={`Food ${i + 1} protein grams`}
                        type="number"
                        min={0}
                        value={mf.nutrition.proteinG}
                        onChange={(e) => setMacro(i, 'proteinG', Number(e.target.value) || 0)}
                      />
                      g
                    </label>
                    <label title="carbs">
                      🍚
                      <input
                        aria-label={`Food ${i + 1} carbs grams`}
                        type="number"
                        min={0}
                        value={mf.nutrition.carbsG}
                        onChange={(e) => setMacro(i, 'carbsG', Number(e.target.value) || 0)}
                      />
                      g
                    </label>
                    <label title="fat">
                      🧈
                      <input
                        aria-label={`Food ${i + 1} fat grams`}
                        type="number"
                        min={0}
                        value={mf.nutrition.fatG}
                        onChange={(e) => setMacro(i, 'fatG', Number(e.target.value) || 0)}
                      />
                      g
                    </label>
                    <span className="source-tag">[{sourceLabel(mf.nutrition.source)}]</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    aria-label={`Food ${i + 1} weight in grams`}
                    type="number"
                    min={1}
                    value={mf.food.estimatedWeightG}
                    onChange={(e) =>
                      updateFood(i, { estimatedWeightG: Math.max(1, Number(e.target.value) || 1) })
                    }
                    style={{ width: 64 }}
                  />
                  <span className="muted">g</span>
                  <button
                    type="button"
                    aria-label={`Remove food ${i + 1}`}
                    className="btn secondary"
                    onClick={() => removeFood(i)}
                    style={{ padding: '4px 8px' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <div className="total">
              <span>Total</span>
              <MacroLine
                energyKcal={resolved.total.energyKcal}
                proteinG={resolved.total.proteinG}
                carbsG={resolved.total.carbsG}
                fatG={resolved.total.fatG}
                sourceLabel={sourceLabel(resolved.total.source)}
              />
            </div>
          </div>

          {/* In-page Save/Back are hidden when the native Telegram MainButton
              is driving Save (still shown in browser dev). */}
          {!nativeSave && (
            <div className="actions">
              <button type="button" className="btn secondary full" onClick={onBack}>
                Back
              </button>
              <button
                type="button"
                className="btn full"
                disabled={busy !== null || foods.length === 0}
                onClick={handleSave}
              >
                {busy === 'saving' ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn secondary full"
            onClick={requestDelete}
            style={{ marginTop: 12, color: 'var(--warn)' }}
          >
            Delete meal
          </button>

          {confirmDelete && (
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm delete"
              onClick={(e) => {
                if (e.target === e.currentTarget && busy === null) setConfirmDelete(false);
              }}
            >
              <div className="modal">
                <h2 style={{ margin: '0 0 4px' }}>Delete meal?</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  This can't be undone.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn secondary full"
                    disabled={busy !== null}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn full"
                    style={{ background: 'var(--warn)' }}
                    disabled={busy !== null}
                    onClick={handleDelete}
                  >
                    {busy === 'deleting' ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
