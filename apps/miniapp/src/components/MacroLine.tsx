import { Badge } from '@/components/ui/badge';
import { Beef, Droplet, Flame, type LucideIcon, Sprout, Wheat } from 'lucide-react';

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
const ICON = 'size-4 stroke-[1.75]';

/** Macro display with icons: kcal, protein, carbs and fat. */
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
    return (
      <span
        className="text-muted-foreground inline-flex items-center gap-1 text-sm"
        title="calories"
        aria-label={`${fmt(energyKcal)} calories`}
      >
        <Flame className={ICON} aria-hidden />
        {fmt(energyKcal)} kcal
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span
        title="calories"
        className="inline-flex items-center gap-1 whitespace-nowrap"
        aria-label={`${fmt(energyKcal)} calories`}
      >
        <Flame className={ICON} aria-hidden />
        {fmt(energyKcal)} kcal
      </span>
      <span
        title="protein"
        className="inline-flex items-center gap-1 whitespace-nowrap"
        aria-label={`${fmt(proteinG)} grams protein`}
      >
        <Beef className={ICON} aria-hidden />
        {fmt(proteinG)}g
      </span>
      <span
        title="carbs"
        className="inline-flex items-center gap-1 whitespace-nowrap"
        aria-label={`${fmt(carbsG)} grams carbs`}
      >
        <Wheat className={ICON} aria-hidden />
        {fmt(carbsG)}g
      </span>
      <span
        title="fat"
        className="inline-flex items-center gap-1 whitespace-nowrap"
        aria-label={`${fmt(fatG)} grams fat`}
      >
        <Droplet className={ICON} aria-hidden />
        {fmt(fatG)}g
      </span>
      {fiberG != null ? (
        <span
          title="fiber"
          className="inline-flex items-center gap-1 whitespace-nowrap"
          aria-label={`${fmt(fiberG)} grams fiber`}
        >
          <Sprout className={ICON} aria-hidden />
          {fmt(fiberG)}g
        </span>
      ) : null}
      {sourceLabel ? (
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {sourceLabel}
        </Badge>
      ) : null}
    </div>
  );
}

/** What each macro icon means — shown once so the icons are self-explaining. */
export const MACRO_LEGEND: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Flame, label: 'calories' },
  { icon: Beef, label: 'protein' },
  { icon: Wheat, label: 'carbs' },
  { icon: Droplet, label: 'fat' },
];

/** A small inline legend explaining the macro icons. */
export function MacroLegend({ className }: { className?: string }) {
  return (
    <div
      className={`text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className ?? ''}`}
    >
      {MACRO_LEGEND.map((m) => (
        <span key={m.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          <m.icon className={ICON} aria-hidden />
          {m.label}
        </span>
      ))}
    </div>
  );
}
