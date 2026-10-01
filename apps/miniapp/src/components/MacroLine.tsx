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

/** Macro display with icons: 🔥 kcal · 🥩 protein · 🍚 carbs · 🧈 fat. */
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
        className="text-muted-foreground text-sm"
        title="calories"
        aria-label={`${fmt(energyKcal)} calories`}
      >
        <span aria-hidden="true">🔥</span> {fmt(energyKcal)} kcal
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span
        title="calories"
        className="whitespace-nowrap"
        aria-label={`${fmt(energyKcal)} calories`}
      >
        <span aria-hidden="true">🔥</span> {fmt(energyKcal)} kcal
      </span>
      <span
        title="protein"
        className="whitespace-nowrap"
        aria-label={`${fmt(proteinG)} grams protein`}
      >
        <span aria-hidden="true">🥩</span> {fmt(proteinG)}g
      </span>
      <span title="carbs" className="whitespace-nowrap" aria-label={`${fmt(carbsG)} grams carbs`}>
        <span aria-hidden="true">🍚</span> {fmt(carbsG)}g
      </span>
      <span title="fat" className="whitespace-nowrap" aria-label={`${fmt(fatG)} grams fat`}>
        <span aria-hidden="true">🧈</span> {fmt(fatG)}g
      </span>
      {fiberG != null ? (
        <span title="fiber" className="whitespace-nowrap" aria-label={`${fmt(fiberG)} grams fiber`}>
          <span aria-hidden="true">🌾</span> {fmt(fiberG)}g
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

/** What each macro emoji means — shown once so the icons are self-explaining. */
export const MACRO_LEGEND: Array<{ icon: string; label: string }> = [
  { icon: '🔥', label: 'calories' },
  { icon: '🥩', label: 'protein' },
  { icon: '🍚', label: 'carbs' },
  { icon: '🧈', label: 'fat' },
];

/** A small inline legend explaining the macro emojis (🔥/🥩/🍚/🧈). */
export function MacroLegend({ className }: { className?: string }) {
  return (
    <div
      className={`text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className ?? ''}`}
    >
      {MACRO_LEGEND.map((m) => (
        <span key={m.label} className="whitespace-nowrap">
          <span aria-hidden="true">{m.icon}</span> {m.label}
        </span>
      ))}
    </div>
  );
}
