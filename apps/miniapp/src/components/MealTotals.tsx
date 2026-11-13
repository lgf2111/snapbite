import { Badge } from '@/components/ui/badge';

export interface MealTotalsProps {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Where the totals came from, e.g. "edited" or "AI estimate". */
  source?: string;
}

interface Cell {
  key: string;
  value: string;
  unit: string;
  label: string;
}

/**
 * The summary strip under the editable foods: one header line and four equal
 * cells. Each cell puts the value and its dimmed unit on one line, with the
 * macro name in words underneath, so every number is named.
 *
 * All four values are body 500 sans in a four-track grid. Cells are `min-w-0`,
 * so a four-digit calorie count cannot widen one column and shunt the others.
 */
export function MealTotals({ energyKcal, proteinG, carbsG, fatG, source }: MealTotalsProps) {
  const cells: Cell[] = [
    {
      key: 'kcal',
      value: Math.round(energyKcal).toLocaleString(),
      unit: 'kcal',
      label: 'Calories',
    },
    { key: 'protein', value: String(proteinG), unit: 'g', label: 'Protein' },
    { key: 'carbs', value: String(carbsG), unit: 'g', label: 'Carbs' },
    { key: 'fat', value: String(fatG), unit: 'g', label: 'Fat' },
  ];

  return (
    <section aria-label="Meal totals">
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted-foreground">Total</span>
        {source ? <Badge variant="outline">{source}</Badge> : null}
      </div>

      <div data-testid="totals-grid" className="mt-2 grid grid-cols-4 gap-x-2">
        {cells.map((cell) => (
          <div key={cell.key} data-testid="total-cell" className="min-w-0">
            <div data-testid="total-value" className="flex items-baseline whitespace-nowrap">
              <span className="tabular text-body font-medium">{cell.value}</span>
              <span className="text-muted-foreground text-caption">
                {/* kcal takes a no-break space; grams are written tight. */}
                {cell.unit === 'kcal' ? '\u00a0' : ''}
                {cell.unit}
              </span>
            </div>
            <div className="text-caption text-muted-foreground mt-1 truncate">{cell.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
