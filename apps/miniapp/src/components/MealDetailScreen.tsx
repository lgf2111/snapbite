import {
  aggregate,
  type FoodItem,
  type MealResult,
  PROVIDER_PRESETS,
  resolveFoodNutrition,
  sourceLabel,
} from '@snapbite/core';
import { RotateCcw, Share2, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCached, setCached } from '@/lib/cache';
import { shareOrSaveImage } from '@/lib/share';
import { renderMealShareCard } from '@/lib/shareCard';
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
import { type Backend, type RecentMeal, shortMealTitle } from '@/lib/backend';
import { hapticImpact } from '@/lib/telegram';
import { useBackButton, useMainButton } from '@/lib/useTelegramButtons';
import { cn } from '@/lib/utils';
import { MacroLegend, MacroLine } from './MacroLine.js';
import { ReviseWithAiDialog } from './UpdateWithAi.js';

type ToastKind = 'success' | 'error' | 'info';

interface MealDetailScreenProps {
  backend: Backend;
  mealId: string;
  /** The meal summary from Home, used to render instantly (no loading flash). */
  initialMeal?: RecentMeal | null;
  onBack: () => void;
  onChanged: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
  /** When set, immediately start an AI edit with this instruction on open. */
  initialAiInstruction?: string | null;
}

type MacroKey = 'energyKcal' | 'proteinG' | 'carbsG' | 'fatG';

/** Short human labels for the provider id shown in the detail header. */
const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDER_PRESETS).map((p) => [p.id, p.label]),
);

/** A draft food row: the editable food plus a pending-remove flag. */
interface DraftFood extends FoodItem {
  pendingRemove?: boolean;
}

/** Converts a loaded MealDetail food into an editable draft food. */
function detailFoodToDraft(f: MealDetail['foods'][number]): DraftFood {
  return {
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
  };
}

/** Converts a MealResult food (from an AI draft) into an editable draft food. */
function mealFoodToDraft(mf: MealResult['foods'][number]): DraftFood {
  return {
    name: mf.food.name,
    estimatedWeightG: mf.food.estimatedWeightG,
    portion: mf.food.portion ?? undefined,
    quantity: mf.food.quantity,
    confidence: mf.food.confidence,
    manualNutrition: {
      energyKcal: mf.nutrition.energyKcal,
      proteinG: mf.nutrition.proteinG,
      carbsG: mf.nutrition.carbsG,
      fatG: mf.nutrition.fatG,
    },
  };
}

/** Builds a provisional MealDetail from a Home summary so the screen can render
 * instantly (name + totals + photo) while the full per-food detail loads. */
function recentToDetail(m: RecentMeal): MealDetail {
  return {
    id: m.id,
    loggedAt: m.when,
    createdAt: m.when,
    title: m.label,
    notes: null,
    confidence: null,
    telegramFileId: m.previewUrl ? 'preview' : null,
    aiProvider: m.aiProvider,
    foods: [
      {
        id: 'summary',
        name: m.label,
        estimatedWeightG: null,
        portion: null,
        quantity: 1,
        confidence: null,
        energyKcal: m.energyKcal,
        proteinG: m.proteinG,
        carbsG: m.carbsG,
        fatG: m.fatG,
        nutritionSource: 'ai_estimate',
      },
    ],
    total: {
      energyKcal: m.energyKcal ?? 0,
      proteinG: m.proteinG ?? 0,
      carbsG: m.carbsG ?? 0,
      fatG: m.fatG ?? 0,
      source: 'ai_estimate',
    },
  };
}

export function MealDetailScreen({
  backend,
  mealId,
  initialMeal,
  onBack,
  onChanged,
  onToast,
  initialAiInstruction,
}: MealDetailScreenProps) {
  // Seed instantly from a cached full detail if present, else from the Home
  // summary, so there's no "Loading…" flash when opening a meal.
  const seed = getCached<MealDetail>(`meal:${mealId}`) ?? (initialMeal ? recentToDetail(initialMeal) : null);
  const [detail, setDetail] = useState<MealDetail | null>(seed);
  const [foods, setFoods] = useState<DraftFood[]>(seed ? seed.foods.map(detailFoodToDraft) : []);
  // Serialized snapshot of the foods as loaded, to detect unsaved edits.
  const [baseline, setBaseline] = useState(seed ? JSON.stringify(seed.foods.map(detailFoodToDraft)) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false); // generating the preview
  const [sharing, setSharing] = useState(false); // sharing from the preview
  const [cardPreview, setCardPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [savingFav, setSavingFav] = useState(false);
  /** The favorite id when this meal is already saved (filled star); null otherwise. */
  const [savedFavId, setSavedFavId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [favLabel, setFavLabel] = useState('');

  useEffect(() => {
    const apply = (d: MealDetail) => {
      setDetail(d);
      const loaded = d.foods.map(detailFoodToDraft);
      setFoods(loaded);
      setBaseline(JSON.stringify(loaded));
    };
    // Show a cached copy instantly (reopening a meal you just saw), then fetch
    // fresh. For a NEW meal (no cache) this is the same as a plain fetch — no
    // extra delay compared to the pre-cache behavior.
    const cached = getCached<MealDetail>(`meal:${mealId}`);
    if (cached) apply(cached);
    backend
      .detail(mealId)
      .then((d) => {
        setCached(`meal:${mealId}`, d);
        apply(d);
      })
      .catch((e: unknown) => {
        if (!cached) setError(e instanceof Error ? e.message : 'Failed to load');
      });
  }, [backend, mealId]);

  // Detect whether this meal is already a saved favorite (filled star).
  useEffect(() => {
    if (!detail) return;
    let active = true;
    const label = shortMealTitle(detail.title, detail.foods.map((f) => f.name));
    const kcal = Math.round(detail.total?.energyKcal ?? 0);
    backend
      .listFavorites()
      .then((favs) => {
        if (!active) return;
        const match = favs.find(
          (f) => f.label === label && Math.round(f.meal.total.energyKcal) === kcal,
        );
        setSavedFavId(match ? match.id : null);
      })
      .catch(() => active && setSavedFavId(null));
    return () => {
      active = false;
    };
  }, [backend, detail]);

  // If opened with an instruction (from the Home row), start the AI edit.
  useEffect(() => {
    if (initialAiInstruction && detail) setAiOpen(true);
  }, [initialAiInstruction, detail]);

  // Release the preview object URL if we unmount while it's still open.
  useEffect(() => {
    return () => {
      if (cardPreview) URL.revokeObjectURL(cardPreview.url);
    };
  }, [cardPreview]);

  // Dirty when the draft (incl. pending removals) differs from the loaded meal.
  const dirty = useMemo(() => JSON.stringify(foods) !== baseline, [foods, baseline]);

  // Foods that will actually be saved (pending-removes excluded).
  const kept = useMemo(() => foods.filter((f) => !f.pendingRemove), [foods]);

  const resolved = useMemo(() => {
    const mealFoods = kept.map((food) => ({
      food,
      nutrition:
        resolveFoodNutrition(food) ??
        ({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, source: 'ai_estimate' } as const),
    }));
    return { foods: mealFoods, total: aggregate(mealFoods.map((f) => f.nutrition)) };
  }, [kept]);

  function updateFood(i: number, patch: Partial<DraftFood>) {
    setFoods((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  /** Toggle a food's pending-remove flag (soft delete — reviewable until save). */
  function toggleRemove(i: number) {
    setFoods((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, pendingRemove: !f.pendingRemove } : f)),
    );
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

  /**
   * Applies an AI-revised meal to the draft. Foods the AI kept/added replace the
   * list; foods the AI dropped aren't deleted outright — they're marked
   * pending-remove so the user can review (and Undo) before saving.
   */
  function applyAiDraft(revised: MealResult) {
    const revisedByName = new Map(revised.foods.map((mf) => [mf.food.name.toLowerCase(), mf]));
    const currentNames = new Set(foods.map((f) => f.name.toLowerCase()));

    // Existing foods: update from the revision, or mark pending-remove if dropped.
    const merged: DraftFood[] = foods.map((f) => {
      const key = f.name.toLowerCase();
      const match = revisedByName.get(key);
      if (match) return { ...mealFoodToDraft(match), pendingRemove: false };
      return { ...f, pendingRemove: true };
    });

    // New foods the AI added (not present before) get appended.
    for (const mf of revised.foods) {
      if (!currentNames.has(mf.food.name.toLowerCase())) merged.push(mealFoodToDraft(mf));
    }

    setFoods(merged);
  }

  async function handleSave() {
    if (!detail || kept.length === 0 || !dirty) return;
    setBusy('saving');
    const meal: MealResult = {
      foods: resolved.foods,
      total: resolved.total,
      confidence: detail.confidence ?? 0.5,
      needsConfirmation: false,
      ...(detail.title ? { title: detail.title } : {}),
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

  /** Builds the share-card image from the current (possibly edited) meal. */
  async function buildCardBlob(): Promise<Blob> {
    const title = shortMealTitle(detail?.title, kept.map((f) => f.name));
    return renderMealShareCard({
      photoUrl: detail?.telegramFileId ? backend.photoUrl(mealId) : null,
      title,
      calories: resolved.total.energyKcal,
      proteinG: resolved.total.proteinG,
      carbsG: resolved.total.carbsG,
      fatG: resolved.total.fatG,
    });
  }

  /** The default favorite name for the current meal. */
  function defaultFavLabel(): string {
    return shortMealTitle(detail?.title, kept.map((f) => f.name));
  }

  /** Star tapped: if already saved, unsave; otherwise open the rename dialog. */
  function onToggleFavorite() {
    if (savingFav) return;
    if (savedFavId) {
      void unsaveFavorite();
    } else {
      setFavLabel(defaultFavLabel());
      setRenameOpen(true);
    }
  }

  /** Saves the current meal as a favorite under the entered name. */
  async function confirmSaveFavorite() {
    if (!detail || kept.length === 0 || savingFav) return;
    setSavingFav(true);
    const label = favLabel.trim() || defaultFavLabel();
    const meal: MealResult = {
      foods: resolved.foods,
      total: resolved.total,
      confidence: detail.confidence ?? 0.5,
      needsConfirmation: false,
      // Persist the chosen name as the meal's title so it shows nicely later.
      title: label,
      ...(detail.notes ? { notes: detail.notes } : {}),
    };
    try {
      const id = await backend.addFavorite(meal, label);
      setSavedFavId(id);
      setRenameOpen(false);
      onToast?.('success', 'Saved to your meals');
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not save meal');
    } finally {
      setSavingFav(false);
    }
  }

  /** Removes this meal from saved meals (star was filled). */
  async function unsaveFavorite() {
    if (!savedFavId || savingFav) return;
    setSavingFav(true);
    try {
      await backend.removeFavorite(savedFavId);
      setSavedFavId(null);
      onToast?.('success', 'Removed from saved meals');
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not remove saved meal');
    } finally {
      setSavingFav(false);
    }
  }

  /** Generates the card and opens a preview so the user can see it first. */
  async function openCardPreview() {
    if (cardBusy) return;
    setCardBusy(true);
    try {
      const blob = await buildCardBlob();
      const url = URL.createObjectURL(blob);
      setCardPreview({ blob, url });
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not create image');
    } finally {
      setCardBusy(false);
    }
  }

  /** Closes the preview and releases the object URL. */
  function closeCardPreview() {
    setCardPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  /** Shares the previewed card via the native sheet (or downloads as fallback). */
  async function shareFromPreview() {
    if (!cardPreview || sharing) return;
    setSharing(true);
    try {
      const result = await shareOrSaveImage(
        cardPreview.blob,
        'snapbite-meal.png',
        'My meal, logged with SnapBite',
      );
      if (result === 'downloaded') onToast?.('success', 'Image saved');
      if (result !== 'cancelled') closeCardPreview();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not share');
    } finally {
      setSharing(false);
    }
  }

  /** Discard unsaved edits: revert to the loaded meal, or leave if clean. */
  function discardAndBack() {
    if (dirty) setConfirmDiscard(true);
    else onBack();
  }

  useBackButton(true, () => {
    if (renameOpen) setRenameOpen(false);
    else if (cardPreview) closeCardPreview();
    else if (confirmDelete) setConfirmDelete(false);
    else if (confirmDiscard) setConfirmDiscard(false);
    else discardAndBack();
  });

  const nativeSave = useMainButton(detail !== null && !confirmDelete && dirty, {
    text: busy === 'saving' ? 'Saving…' : 'Save changes',
    onClick: () => void handleSave(),
    enabled: busy === null && kept.length > 0 && dirty,
    loading: busy === 'saving',
  });

  const macroFields: Array<{ key: MacroKey; icon: string; suffix: string }> = [
    { key: 'energyKcal', icon: '🔥', suffix: 'kcal' },
    { key: 'proteinG', icon: '🥩', suffix: 'g' },
    { key: 'carbsG', icon: '🍚', suffix: 'g' },
    { key: 'fatG', icon: '🧈', suffix: 'g' },
  ];

  // Map draft-food indices to their resolved nutrition (kept foods only).
  const resolvedByFood = new Map(resolved.foods.map((mf) => [mf.food, mf.nutrition]));

  return (
    <div className="flex flex-1 flex-col gap-4 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit meal</h1>
        <Button variant="ghost" size="icon" onClick={discardAndBack} aria-label="Discard and close">
          <X className="size-5" />
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {!detail && !error && <p className="text-muted-foreground text-sm">Loading…</p>}

      {detail && (
        <>
          <p className="text-muted-foreground text-sm">
            {new Date(detail.loggedAt).toLocaleString()}
            {detail.aiProvider ? ` · analyzed by ${PROVIDER_LABEL[detail.aiProvider] ?? detail.aiProvider}` : ''}
          </p>
          {detail.telegramFileId && backend.photoUrl(mealId) && (
            <img
              src={backend.photoUrl(mealId) as string}
              alt="Meal"
              className="w-full rounded-xl border object-cover"
            />
          )}

          {/* Save as a reusable favorite + share a composed image. */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 gap-2"
              disabled={savingFav}
              aria-pressed={savedFavId !== null}
              onClick={onToggleFavorite}
            >
              <Star
                className={cn('size-4', savedFavId !== null && 'fill-current text-primary')}
              />
              {savedFavId !== null ? 'Saved' : 'Save meal'}
            </Button>
            <Button
              variant="secondary"
              className="flex-1 gap-2"
              disabled={cardBusy}
              onClick={() => void openCardPreview()}
            >
              <Share2 className="size-4" />
              {cardBusy ? 'Preparing…' : 'Share'}
            </Button>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-4">
              {foods.map((food, i) => {
                const nutrition =
                  resolvedByFood.get(food) ??
                  resolveFoodNutrition(food) ?? {
                    energyKcal: 0,
                    proteinG: 0,
                    carbsG: 0,
                    fatG: 0,
                  };
                const removing = Boolean(food.pendingRemove);
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0',
                      removing && 'opacity-50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Food ${i + 1} name`}
                        value={food.name}
                        disabled={removing}
                        onChange={(e) => updateFood(i, { name: e.target.value })}
                        className={cn('font-medium', removing && 'line-through')}
                      />
                      {removing ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Keep food ${i + 1}`}
                          onClick={() => toggleRemove(i)}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove food ${i + 1}`}
                          onClick={() => toggleRemove(i)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {removing ? (
                      <p className="text-muted-foreground text-xs">Will be removed when you save.</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {macroFields.map(({ key, icon, suffix }) => (
                          <label key={key} className="flex items-center gap-1 text-xs" title={key}>
                            <span>{icon}</span>
                            <Input
                              aria-label={`Food ${i + 1} ${key}`}
                              type="number"
                              min={0}
                              value={nutrition[key]}
                              onChange={(e) => setMacro(i, key, Number(e.target.value) || 0)}
                              className="h-8 w-16 px-2"
                            />
                            <span className="text-muted-foreground">{suffix}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

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
              <MacroLegend className="pt-1" />
            </CardContent>
          </Card>

          <Button variant="secondary" className="gap-2" onClick={() => setAiOpen(true)}>
            <Sparkles className="text-primary size-4" /> Update with AI
          </Button>

          <ReviseWithAiDialog
            open={aiOpen}
            onOpenChange={setAiOpen}
            backend={backend}
            mealId={mealId}
            initialInstruction={initialAiInstruction ?? ''}
            onDraft={(revised) => applyAiDraft(revised)}
            {...(onToast ? { onToast } : {})}
          />

          {!nativeSave && (
            <Button
              className="w-full"
              disabled={busy !== null || kept.length === 0 || !dirty}
              onClick={handleSave}
            >
              {busy === 'saving' ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
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

          <Dialog open={renameOpen} onOpenChange={(o) => (savingFav ? null : setRenameOpen(o))}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save this meal</DialogTitle>
                <DialogDescription>
                  Name it so you can find and log it again later.
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                value={favLabel}
                disabled={savingFav}
                placeholder="e.g. Chicken rice bowl"
                onChange={(e) => setFavLabel(e.target.value)}
              />
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={savingFav}
                  onClick={() => setRenameOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={savingFav || favLabel.trim().length === 0}
                  onClick={() => void confirmSaveFavorite()}
                >
                  {savingFav ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={cardPreview !== null}
            onOpenChange={(open) => {
              if (!open) closeCardPreview();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Share this meal</DialogTitle>
                <DialogDescription>Preview your meal card, then share it.</DialogDescription>
              </DialogHeader>
              {cardPreview && (
                <img
                  src={cardPreview.url}
                  alt="Meal card preview"
                  className="mx-auto max-h-[60vh] w-auto rounded-xl border"
                />
              )}
              <DialogFooter>
                <Button variant="secondary" onClick={closeCardPreview} disabled={sharing}>
                  Cancel
                </Button>
                <Button className="gap-2" onClick={() => void shareFromPreview()} disabled={sharing}>
                  <Share2 className="size-4" />
                  {sharing ? 'Sharing…' : 'Share'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Discard changes?</DialogTitle>
                <DialogDescription>Your unsaved edits will be lost.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
                <Button variant="destructive" onClick={onBack}>
                  Discard
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
