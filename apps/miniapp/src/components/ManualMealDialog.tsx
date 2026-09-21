import { buildManualMeal, type ManualFoodInput } from '@snapbite/core';
import { Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Favorite } from '@/lib/api';
import type { Backend } from '@/lib/backend';

type ToastKind = 'success' | 'error' | 'info';

interface ManualMealDialogProps {
  backend: Backend;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

const EMPTY = { name: '', energyKcal: '', proteinG: '', carbsG: '', fatG: '' };

/**
 * Manually log a meal without AI or a photo — just a name and macros. Works for
 * users who haven't added an API key. Saves via `backend.logManual`.
 */
export function ManualMealDialog({
  backend,
  open,
  onOpenChange,
  onLogged,
  onToast,
}: ManualMealDialogProps) {
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [loggingFavId, setLoggingFavId] = useState<string | null>(null);

  // Load saved meals when the dialog opens so the user can re-log one.
  useEffect(() => {
    if (!open) return;
    let active = true;
    backend
      .listFavorites()
      .then((f) => active && setFavorites(f))
      .catch(() => active && setFavorites([]));
    return () => {
      active = false;
    };
  }, [open, backend]);

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const canSave = form.name.trim().length > 0 && !busy;

  /** Logs a copy of a saved meal to today (no AI, no key needed). */
  async function logFavorite(fav: Favorite) {
    if (busy || loggingFavId) return;
    setLoggingFavId(fav.id);
    try {
      await backend.logManual(fav.meal);
      onToast?.('success', `Logged ${fav.label}`);
      onOpenChange(false);
      onLogged();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not log meal');
    } finally {
      setLoggingFavId(null);
    }
  }

  async function removeFavorite(fav: Favorite) {
    try {
      await backend.removeFavorite(fav.id);
      setFavorites((prev) => (prev ? prev.filter((f) => f.id !== fav.id) : prev));
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not remove saved meal');
    }
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const food: ManualFoodInput = {
        name: form.name,
        energyKcal: num(form.energyKcal),
        proteinG: num(form.proteinG),
        carbsG: num(form.carbsG),
        fatG: num(form.fatG),
      };
      const meal = buildManualMeal([food]);
      await backend.logManual(meal);
      onToast?.('success', 'Meal logged');
      setForm({ ...EMPTY });
      onOpenChange(false);
      onLogged();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not log meal');
    } finally {
      setBusy(false);
    }
  }

  const macroFields: Array<{ key: keyof typeof form; label: string; icon: string }> = [
    { key: 'energyKcal', label: 'Calories', icon: '🔥' },
    { key: 'proteinG', label: 'Protein (g)', icon: '🥩' },
    { key: 'carbsG', label: 'Carbs (g)', icon: '🍚' },
    { key: 'fatG', label: 'Fat (g)', icon: '🧈' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a meal</DialogTitle>
          <DialogDescription>
            Log a meal by hand — no photo or AI key needed. Enter what you ate and its macros
            (estimates are fine; you can edit later).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {favorites && favorites.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Saved meals</Label>
              <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {favorites.map((fav) => (
                  <div key={fav.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || loggingFavId !== null}
                      onClick={() => void logFavorite(fav)}
                      className="border-input hover:bg-accent flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                    >
                      <Star className="text-primary size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{fav.label}</span>
                      {fav.energyKcal != null && (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {loggingFavId === fav.id ? 'Logging…' : `${Math.round(fav.energyKcal)} kcal`}
                        </span>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${fav.label}`}
                      disabled={busy || loggingFavId !== null}
                      onClick={() => void removeFavorite(fav)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">Tap a saved meal to log it again.</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mm-name">What did you eat?</Label>
            <Input
              id="mm-name"
              autoFocus
              placeholder="e.g. Chicken rice"
              value={form.name}
              disabled={busy}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {macroFields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`mm-${f.key}`}>
                  {f.icon} {f.label}
                </Label>
                <Input
                  id={`mm-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="0"
                  value={form[f.key]}
                  disabled={busy}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {busy ? 'Logging…' : 'Log meal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
