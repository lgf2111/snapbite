import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Favorite } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { type ManualFoodInput, buildManualMeal } from '@snapbite/core';
import { Star, Trash2, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ManualMealDialogProps {
  backend: Backend;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: () => void;
  onToast?: (kind: ToastKind, message: string) => void;
}

const EMPTY = { name: '', energyKcal: '', proteinG: '', carbsG: '', fatG: '' };

/** A calorie count is usable when it is a real, non-negative number. */
function validKcal(raw: string): boolean {
  if (raw.trim() === '') return false;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0;
}

/**
 * Manually log a meal without AI or a photo — just a name and macros. Works for
 * users who haven't added an API key. Saves via `backend.logManual`.
 *
 * The sheet is a flex column of exactly three children: a header that never
 * scrolls, a body that owns all of the content and all of the scrolling, and a
 * footer that is the body's sibling. The footer therefore sits below the body
 * by layout — no field can ever end up underneath it, whether the keyboard is
 * up or not. Height is bounded by `--keyboard-inset`, so opening the keyboard
 * shrinks the sheet and the body scrolls instead of hiding the last fields.
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
  const [showSaved, setShowSaved] = useState(true);
  const loggingFavId: string | null = null;
  const nameRef = useRef<HTMLInputElement>(null);
  const kcalRef = useRef<HTMLInputElement>(null);

  // Load saved meals when the dialog opens so the user can re-log one.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setShowSaved(true);
    backend
      .listFavorites()
      .then((f) => active && setFavorites(f))
      .catch(() => active && setFavorites([]));
    return () => {
      active = false;
    };
  }, [open, backend]);

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const nameValid = form.name.trim().length > 0;
  const kcalValid = validKcal(form.energyKcal);
  const canSave = nameValid && kcalValid && !busy;

  /**
   * Prefills the form from a saved meal so the user can tweak it before logging
   * (edit-then-log). Totals come from the favorite's meal total.
   */
  function pickFavorite(fav: Favorite) {
    if (busy || loggingFavId) return;
    const t = fav.meal.total;
    setForm({
      name: fav.label,
      energyKcal: String(Math.round(t.energyKcal)),
      proteinG: String(Math.round(t.proteinG)),
      carbsG: String(Math.round(t.carbsG)),
      fatG: String(Math.round(t.fatG)),
    });
    // Fold the picker away so the editable form is front-and-center.
    setShowSaved(false);
  }

  async function removeFavorite(fav: Favorite) {
    try {
      await backend.removeFavorite(fav.id);
      setFavorites((prev) => (prev ? prev.filter((f) => f.id !== fav.id) : prev));
      onToast?.('success', `Removed ${fav.label}`);
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not remove saved meal');
    }
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (busy || !nameValid || !kcalValid) return;
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

  /** Validates, then either logs or moves focus to the first field to fix. */
  function attemptSave() {
    if (busy) return;
    if (!nameValid) {
      nameRef.current?.focus();
      return;
    }
    if (!kcalValid) {
      kcalRef.current?.focus();
      return;
    }
    void save();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    attemptSave();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    // Enter always takes the same validation path as the button: log when the
    // form is valid, otherwise move focus to the field that needs fixing. The
    // footer button is disabled while invalid, so implicit submission would
    // otherwise do nothing.
    event.preventDefault();
    attemptSave();
  }

  const macroFields: Array<{ key: keyof typeof form; label: string; icon: string }> = [
    { key: 'energyKcal', label: 'Calories', icon: '🔥' },
    { key: 'proteinG', label: 'Protein (g)', icon: '🥩' },
    { key: 'carbsG', label: 'Carbs (g)', icon: '🍚' },
    { key: 'fatG', label: 'Fat (g)', icon: '🧈' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : onOpenChange(o))}>
      <DialogContent
        hideClose
        className="flex max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col gap-0 overflow-hidden p-0"
      >
        <header
          data-slot="manual-header"
          className="flex shrink-0 items-start justify-between gap-2 border-b px-5 pt-5 pb-4"
        >
          <DialogTitle>Add a meal</DialogTitle>
          <DialogClose className="focus-visible:ring-ring/50 -mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:outline-none">
            <X className="size-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </header>

        <div
          data-slot="manual-body"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
        >
          <form
            id="manual-meal-form"
            className="flex min-w-0 flex-col gap-3"
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
          >
            <DialogDescription className="text-caption">
              Log a meal by hand — no photo or AI key needed. Enter what you ate and its macros
              (estimates are fine; you can edit later).
            </DialogDescription>

            {showSaved && favorites && favorites.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label>Saved meals</Label>
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                  {favorites.map((fav) => (
                    <div key={fav.id} className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busy || loggingFavId !== null}
                        title={fav.label}
                        onClick={() => pickFavorite(fav)}
                        className="border-input hover:bg-accent flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                      >
                        <Star className="text-primary-text size-4 shrink-0 fill-current" />
                        <span className="min-w-0 flex-1 truncate">{fav.label}</span>
                        {fav.energyKcal != null && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {Math.round(fav.energyKcal)} kcal
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
                <p className="text-muted-foreground text-xs">
                  Tap a saved meal to fill it in below — tweak anything, then log.
                </p>
              </div>
            )}

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="mm-food">What did you eat?</Label>
              <Input
                id="mm-food"
                ref={nameRef}
                autoFocus
                placeholder="e.g. Chicken rice"
                value={form.name}
                disabled={busy}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={false}
                enterKeyHint="next"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {macroFields.map((f) => (
                <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor={`mm-${f.key}`}>
                    {f.icon} {f.label}
                  </Label>
                  <Input
                    id={`mm-${f.key}`}
                    ref={f.key === 'energyKcal' ? kcalRef : undefined}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    placeholder="0"
                    value={form[f.key]}
                    disabled={busy}
                    enterKeyHint={f.key === 'fatG' ? 'done' : 'next'}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </form>
        </div>

        <div
          data-slot="manual-footer"
          className="bg-card flex shrink-0 flex-col gap-2 border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          <Button type="submit" form="manual-meal-form" className="h-12 w-full" disabled={!canSave}>
            {busy ? 'Logging…' : 'Log meal'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground h-11 w-full"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
