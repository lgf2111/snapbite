import { Badge } from '@/components/ui/badge';

interface MacroLineProps {
  energyKcal: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  /** Dietary fiber (grams). Only rendered when provided (non-null). */
  fiberG?: number | null;
  sourceLabel?: string;
  /** Compact = kcal only (for list rows). */
  compact?: boolean;
}

const DASH = '—';
const fmt = (n: number | null | undefined) => (n == null ? DASH : String(n));

/** Macro values as text: kcal, then P/C/F in the food-label abbreviation. */
export function MacroLine({
  energyKcal,
  proteinG,
  carbsG,
  fatG,
  fiberG,
  sourceLabel,
  compact = false,
}: MacroLineProps) {
  if (compact) {
    return <span className="text-muted-foreground text-caption">{fmt(energyKcal)} kcal</span>;
  }
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
      <span className="whitespace-nowrap">{fmt(energyKcal)} kcal</span>
      <span className="whitespace-nowrap">
        <span className="sr-only">protein </span>P {fmt(proteinG)}g
      </span>
      <span className="whitespace-nowrap">
        <span className="sr-only">carbs </span>C {fmt(carbsG)}g
      </span>
      <span className="whitespace-nowrap">
        <span className="sr-only">fat </span>F {fmt(fatG)}g
      </span>
      {fiberG != null ? <span className="whitespace-nowrap">Fiber {fmt(fiberG)}g</span> : null}
      {sourceLabel ? <Badge variant="outline">{sourceLabel}</Badge> : null}
    </div>
  );
}
