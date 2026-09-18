import { buildManualMeal, type ManualFoodInput } from '@foodlog/core';
import { useState } from 'react';
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

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const canSave = form.name.trim().length > 0 && !busy;

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
