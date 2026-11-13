import { Button } from '@/components/ui/button';
import type { RecentMeal } from '@/lib/backend';
import { PROVIDER_PRESETS } from '@snapbite/core';
import { Sparkles } from 'lucide-react';
import { MealThumb } from './MealThumb.js';
import { SwipeableRow } from './SwipeableRow.js';

/** Short human labels for the provider id shown on meal rows. */
const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  ...Object.fromEntries(Object.values(PROVIDER_PRESETS).map((p) => [p.id, p.label])),
};

const NO_VALUE = '—';

interface MealRowProps {
  meal: RecentMeal;
  /** The meal appeared after the list first rendered: it expands in. */
  isNew: boolean;
  onOpen: (meal: RecentMeal) => void;
  onDelete: (meal: RecentMeal) => void;
  onAi: (meal: RecentMeal) => void;
}

/**
 * A logged meal as a flat list row. The parent list supplies the hairlines
 * (`divide-y`); the row is flush to the gutter and at least 80px tall, with the
 * text button stretched to the full row so the whole left side is one target.
 */
export function MealRow({ meal, isNew, onOpen, onDelete, onAi }: MealRowProps) {
  const kcal = `${meal.energyKcal == null ? NO_VALUE : meal.energyKcal} kcal`;
  const provider = meal.aiProvider ? (PROVIDER_LABEL[meal.aiProvider] ?? meal.aiProvider) : null;
  return (
    <SwipeableRow animateIn={isNew} onDelete={() => onDelete(meal)}>
      <div className="flex items-center gap-3 py-3">
        <MealThumb src={meal.previewUrl} />
        <button
          type="button"
          className="min-w-0 flex-1 self-stretch rounded-control text-left transition-transform duration-[120ms] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
          onClick={() => onOpen(meal)}
        >
          <div className="text-body truncate font-medium">{meal.label}</div>
          <div className="text-muted-foreground text-caption tabular">
            {provider ? `${kcal} · ${provider}` : kcal}
          </div>
        </button>
        <Button variant="ghost" size="icon" aria-label="Update with AI" onClick={() => onAi(meal)}>
          <Sparkles className="size-4" />
        </Button>
      </div>
    </SwipeableRow>
  );
}
