import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
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
import { Loader2, Star, Trash2, X } from 'lucide-react';
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

type FieldKey = keyof typeof EMPTY;

/** The fields in reading order, for moving focus to the first one to fix. */
const FIELD_ORDER: FieldKey[] = ['name', 'energyKcal', 'proteinG', 'carbsG', 'fatG'];

const AMOUNT_ERROR = 'Enter a number, 0 or more.';

/** A macro value is usable when it is empty (zero) or a finite, non-negative number. */
function validAmount(raw: string): boolean {
  if (raw.trim() === '') return true;
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
 *
 * The primary button is always live: pressing it with an invalid form marks the
 * fields and moves focus, rather than leaving a disabled button with no reason.
 */
export function ManualMealDialog({
  backend,
  open,
  onOpenChange,
  onLogged,
  onToast,
}: ManualMealDialogProps) {
  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [loggingFavId, setLoggingFavId] = useState<string | null>(null);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});

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

  /** Every field's problem, in one pass, so pressing Log meal marks all of them. */
  function validate(): Partial<Record<FieldKey, string>> {
    const next: Partial<Record<FieldKey, string>> = {};
    if (form.name.trim() === '') next.name = 'Name the meal.';
    if (form.energyKcal.trim() === '') next.energyKcal = 'Enter the calories.';
    else if (!validAmount(form.energyKcal)) next.energyKcal = AMOUNT_ERROR;
    else if (Number(form.energyKcal) <= 0) next.energyKcal = 'Enter the calories.';
    for (const key of ['proteinG', 'carbsG', 'fatG'] as const) {
      if (!validAmount(form[key])) next[key] = AMOUNT_ERROR;
    }
    return next;
  }

  /**
   * A saved meal is logged as it was saved: the capture menu calls this
   * "Re-log a favourite", so a tap must not open a form to confirm again.
   */
  async function logFavorite(fav: Favorite) {
    if (busy || loggingFavId !== null) return;
    setLoggingFavId(fav.id);
    try {
      await backend.logManual(fav.meal);
      onToast?.('success', 'Meal logged');
      onOpenChange(false);
      onLogged();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not log meal');
    } finally {
      setLoggingFavId(null);
    }
  }

  async function removeFavorite(fav: Favorite) {
    if (busy || loggingFavId !== null) return;
    const before = favorites;
    setFavorites((prev) => (prev ? prev.filter((f) => f.id !== fav.id) : prev));
    try {
      await backend.removeFavorite(fav.id);
      onToast?.('success', `Removed ${fav.label}`);
    } catch (e) {
      // The row returns: nothing was removed on the server.
      setFavorites(before);
      onToast?.('error', e instanceof Error ? e.message : 'Could not remove saved meal');
    }
  }

  function set(key: FieldKey, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    // A field's error belongs to the value that failed; the next edit clears it.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function save() {
    if (busy) return;
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
      setErrors({});
      onOpenChange(false);
      onLogged();
    } catch (e) {
      onToast?.('error', e instanceof Error ? e.message : 'Could not log meal');
    } finally {
      setBusy(false);
    }
  }

  /** Validates, then either logs or marks the fields and focuses the first one. */
  function attemptSave() {
    if (busy) return;
    const next = validate();
    setErrors(next);
    const first = FIELD_ORDER.find((key) => next[key]);
    if (first) {
      fieldRefs.current[first]?.focus();
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
    // form is valid, otherwise mark the fields and focus the first to fix.
    event.preventDefault();
    attemptSave();
  }

  const macroFields: Array<{ key: FieldKey; label: string }> = [
    { key: 'energyKcal', label: 'Calories' },
    { key: 'proteinG', label: 'Protein (g)' },
    { key: 'carbsG', label: 'Carbs (g)' },
    { key: 'fatG', label: 'Fat (g)' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : onOpenChange(o))}>
      <DialogContent
        hideClose
        className="flex max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          // The keyboard should come up on the name, not on a saved meal.
          event.preventDefault();
          fieldRefs.current.name?.focus();
        }}
      >
        <header
          data-slot="manual-header"
          className="relative flex shrink-0 items-start justify-between gap-3 border-b px-5 pt-5 pr-12 pb-4"
        >
          <div className="min-w-0 flex-1">
            <DialogTitle>Add a meal</DialogTitle>
            <DialogDescription className="mt-1">
              Log a meal by hand. No photo or AI key needed.
            </DialogDescription>
          </div>
          <DialogClose className="text-muted-foreground hover:bg-accent absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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
            className="flex min-w-0 flex-col gap-4"
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
          >
            {favorites && favorites.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-caption font-medium">Saved meals</h3>
                <div className="divide-border flex max-h-40 flex-col divide-y overflow-y-auto">
                  {favorites.map((fav) => (
                    <div key={fav.id} className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || loggingFavId !== null}
                        title={fav.label}
                        onClick={() => void logFavorite(fav)}
                        className="hover:bg-accent flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left text-body transition-colors active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {loggingFavId === fav.id ? (
                          <Loader2
                            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                        ) : (
                          <Star className="size-4 shrink-0 fill-current" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">{fav.label}</span>
                        {fav.energyKcal != null && (
                          <span className="text-muted-foreground shrink-0 text-caption tabular">
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
              </div>
            )}

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="mm-food">What did you eat?</Label>
              <div className="flex min-w-0 flex-col gap-1">
                <Input
                  id="mm-food"
                  ref={(el) => {
                    fieldRefs.current.name = el;
                  }}
                  autoFocus
                  placeholder="e.g. Chicken rice"
                  value={form.name}
                  disabled={busy}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="sentences"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'mm-food-error' : undefined}
                  onChange={(e) => set('name', e.target.value)}
                />
                {errors.name && (
                  <p id="mm-food-error" className="text-destructive text-caption">
                    {errors.name}
                  </p>
                )}
              </div>
            </div>
            {macroFields.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`mm-${f.key}`}>{f.label}</Label>
                <div className="flex min-w-0 flex-col gap-1">
                  <Input
                    id={`mm-${f.key}`}
                    ref={(el) => {
                      fieldRefs.current[f.key] = el;
                    }}
                    type="text"
                    inputMode="decimal"
                    min="0"
                    placeholder="0"
                    value={form[f.key]}
                    disabled={busy}
                    enterKeyHint={f.key === 'fatG' ? 'done' : 'next'}
                    aria-invalid={Boolean(errors[f.key])}
                    aria-describedby={errors[f.key] ? `mm-${f.key}-error` : undefined}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {errors[f.key] && (
                    <p id={`mm-${f.key}-error`} className="text-destructive text-caption">
                      {errors[f.key]}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </form>
        </div>

        <div
          data-slot="manual-footer"
          className="bg-card flex shrink-0 flex-col border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          <DialogActions>
            <Button type="submit" form="manual-meal-form" className="w-full" disabled={busy}>
              {busy ? 'Logging…' : 'Log meal'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </DialogActions>
        </div>
      </DialogContent>
    </Dialog>
  );
}
