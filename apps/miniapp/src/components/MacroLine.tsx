import { Badge } from '@/components/ui/badge';
import { MACRO_ICONS, MACRO_LABELS, type MacroKey } from '@/lib/macroIcons';

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

/**
 * One macro as a glyph, its number and its unit. The glyph replaces the old
 * P/C/F letter; the macro name stays available to assistive tech.
 */
function MacroValue({ macro, value }: { macro: MacroKey; value: number | null | undefined }) {
  const Icon = MACRO_ICONS[macro];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon data-testid={`macro-icon-${macro}`} className={ICON} aria-hidden />
      <span className="sr-only">{MACRO_LABELS[macro]} </span>
      {fmt(value)}g
    </span>
  );
}

/** Macro values as text: kcal, then the four macros as glyph + number. */
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
      <MacroValue macro="protein" value={proteinG} />
      <MacroValue macro="carbs" value={carbsG} />
      <MacroValue macro="fat" value={fatG} />
      {fiberG != null ? <MacroValue macro="fiber" value={fiberG} /> : null}
      {sourceLabel ? <Badge variant="outline">{sourceLabel}</Badge> : null}
    </div>
  );
}
