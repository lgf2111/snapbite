import { Badge } from '@/components/ui/badge';

interface MacroLineProps {
  energyKcal: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  sourceLabel?: string;
  /** Compact = kcal only (for list rows). */
  compact?: boolean;
}

const DASH = '—';
const fmt = (n: number | null | undefined) => (n == null ? DASH : String(n));

/** Macro display with icons: 🔥 kcal · 🥩 protein · 🍚 carbs · 🧈 fat. */
export function MacroLine({
  energyKcal,
  proteinG,
  carbsG,
  fatG,
  sourceLabel,
  compact = false,
}: MacroLineProps) {
  if (compact) {
    return (
      <span className="text-muted-foreground text-sm" title="calories">
        🔥 {fmt(energyKcal)} kcal
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span title="calories" className="whitespace-nowrap">
        🔥 {fmt(energyKcal)} kcal
      </span>
      <span title="protein" className="whitespace-nowrap">
        🥩 {fmt(proteinG)}g
      </span>
      <span title="carbs" className="whitespace-nowrap">
        🍚 {fmt(carbsG)}g
      </span>
      <span title="fat" className="whitespace-nowrap">
        🧈 {fmt(fatG)}g
      </span>
      {sourceLabel ? (
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {sourceLabel}
        </Badge>
      ) : null}
    </div>
  );
}
