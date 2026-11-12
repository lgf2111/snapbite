import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  /** Calories get the display serif and one type step larger. */
  hero?: boolean;
}

/**
 * The summary strip under the editable foods: one header line and four equal
 * cells. Each cell stacks the value with a dimmed unit and the macro name
 * underneath, so every number is named in words.
 *
 * The four values are bottom-aligned in a fixed-height row, which keeps their
 * baselines together even though calories is set larger. Cells are `min-w-0`
 * in a four-track grid, so a four-digit calorie count cannot widen one column
 * and shunt the others.
 */
export function MealTotals({ energyKcal, proteinG, carbsG, fatG, source }: MealTotalsProps) {
  const cells: Cell[] = [
    {
      key: 'kcal',
      value: String(energyKcal),
      unit: 'kcal',
      label: 'calories',
      hero: true,
    },
    { key: 'protein', value: String(proteinG), unit: 'g', label: 'protein' },
    { key: 'carbs', value: String(carbsG), unit: 'g', label: 'carbs' },
    { key: 'fat', value: String(fatG), unit: 'g', label: 'fat' },
  ];

  return (
    <section aria-label="Meal totals">
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted-foreground">Total</span>
        {source ? (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {source}
          </Badge>
        ) : null}
      </div>

      <div data-testid="totals-grid" className="mt-2 grid grid-cols-4 gap-x-2">
        {cells.map((cell) => (
          <div key={cell.key} data-testid="total-cell" className="min-w-0">
            <div data-testid="total-value" className="flex h-6 items-end whitespace-nowrap">
              <span
                className={cn(
                  'tabular leading-none',
                  cell.hero ? 'font-display text-lg' : 'text-sm font-semibold',
                )}
              >
                {cell.value}
              </span>
              <span className="text-caption ml-1 leading-none opacity-60">{cell.unit}</span>
            </div>
            <div className="text-caption text-muted-foreground mt-1 truncate">{cell.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
