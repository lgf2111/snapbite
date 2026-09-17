import { aggregate, type FoodItem, type MealResult, resolveFoodNutrition, sourceLabel } from '@foodlog/core';
import { Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { MealDetail } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { hapticImpact } from '@/lib/telegram';
import { useBackButton, useMainButton } from '@/lib/useTelegramButtons';
import { MacroLine } from './MacroLine.js';
import { UpdateWithAi } from './UpdateWithAi.js';

type ToastKind = 'success' | 'error' | 'info';

interface MealDetailScreenProps {
  backend: Backend;
  mealId: string;
  onBack: () => void;
  onChanged: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

type MacroKey = 'energyKcal' | 'proteinG' | 'carbsG' | 'fatG';

export function MealDetailScreen({ backend, mealId, onBack, onChanged, onToast }: MealDetailScreenProps) {
  const [detail, setDetail] = useState<MealDetail | null>(null);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Bump to re-fetch the detail (e.g. after an AI revision replaces the meal).
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [backend, mealId, reloadKey]);

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

  function setMacro(i: number, key: MacroKey, value: number) {
    setFoods((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const current =
          f.manualNutrition ??
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
      onToast?.('error', e instanceof Error ? e.message : 'Could not save');
    }
  }

  async function handleDelete() {
    setBusy('deleting');
    try {
      await backend.remove(mealId);
      onChanged();
      onToast?.('success', 'Meal deleted');
      onBack();
    } catch (e) {
      setBusy(null);
      onToast?.('error', e instanceof Error ? e.message : 'Could not delete');
    }
  }

  useBackButton(true, () => {
    if (confirmDelete) setConfirmDelete(false);
    else onBack();
  });

  const nativeSave = useMainButton(detail !== null && !confirmDelete, {
    text: busy === 'saving' ? 'Saving…' : 'Save changes',
    onClick: () => void handleSave(),
    enabled: busy === null && foods.length > 0,
    loading: busy === 'saving',
  });

  const macroFields: Array<{ key: MacroKey; icon: string; suffix: string }> = [
    { key: 'energyKcal', icon: '🔥', suffix: 'kcal' },
    { key: 'proteinG', icon: '🥩', suffix: 'g' },
    { key: 'carbsG', icon: '🍚', suffix: 'g' },
    { key: 'fatG', icon: '🧈', suffix: 'g' },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit meal</h1>
        {!nativeSave && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
            <X className="size-5" />
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {!detail && !error && <p className="text-muted-foreground text-sm">Loading…</p>}

      {detail && (
        <>
          <p className="text-muted-foreground text-sm">
            {new Date(detail.loggedAt).toLocaleString()}
          </p>
          {detail.telegramFileId && backend.photoUrl(mealId) && (
            <img
              src={backend.photoUrl(mealId) as string}
              alt="Meal"
              className="w-full rounded-xl border object-cover"
            />
          )}

          <Card>
            <CardContent className="flex flex-col gap-4">
              {resolved.foods.map((mf, i) => (
                <div key={i} className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Food ${i + 1} name`}
                      value={mf.food.name}
                      onChange={(e) => updateFood(i, { name: e.target.value })}
                      className="font-medium"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove food ${i + 1}`}
                      onClick={() => removeFood(i)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {macroFields.map(({ key, icon, suffix }) => (
                      <label key={key} className="flex items-center gap-1 text-xs" title={key}>
                        <span>{icon}</span>
                        <Input
                          aria-label={`Food ${i + 1} ${key}`}
                          type="number"
                          min={0}
                          value={mf.nutrition[key]}
                          onChange={(e) => setMacro(i, key, Number(e.target.value) || 0)}
                          className="h-8 w-16 px-2"
                        />
                        <span className="text-muted-foreground">{suffix}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-1 text-xs" title="weight">
                      <span>⚖️</span>
                      <Input
                        aria-label={`Food ${i + 1} weight in grams`}
                        type="number"
                        min={1}
                        value={mf.food.estimatedWeightG}
                        onChange={(e) =>
                          updateFood(i, {
                            estimatedWeightG: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="h-8 w-16 px-2"
                      />
                      <span className="text-muted-foreground">g</span>
                    </label>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between pt-1 font-semibold">
                <span>Total</span>
                <MacroLine
                  energyKcal={resolved.total.energyKcal}
                  proteinG={resolved.total.proteinG}
                  carbsG={resolved.total.carbsG}
                  fatG={resolved.total.fatG}
                  sourceLabel={sourceLabel(resolved.total.source)}
                />
              </div>
            </CardContent>
          </Card>

          <UpdateWithAi
            backend={backend}
            mealId={mealId}
            variant="button"
            onDone={() => {
              onChanged();
              setReloadKey((k) => k + 1);
            }}
            {...(onToast ? { onToast } : {})}
          />

          {!nativeSave && (
            <Button
              className="w-full"
              disabled={busy !== null || foods.length === 0}
              onClick={handleSave}
            >
              {busy === 'saving' ? 'Saving…' : 'Save changes'}
            </Button>
          )}

          <Button
            variant="ghost"
            className="text-destructive w-full"
            onClick={() => {
              hapticImpact('medium');
              setConfirmDelete(true);
            }}
          >
            <Trash2 className="size-4" /> Delete meal
          </Button>

          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete meal?</DialogTitle>
                <DialogDescription>This can't be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={handleDelete}>
                  {busy === 'deleting' ? 'Deleting…' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
