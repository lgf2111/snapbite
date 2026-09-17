interface MacroLineProps {
  energyKcal: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  /** Optional source label (e.g. "from table", "AI estimate", "edited"). */
  sourceLabel?: string;
  /** Compact = kcal only with the flame icon (for list rows). */
  compact?: boolean;
}

const DASH = '—';
function fmt(n: number | null | undefined): string {
  return n == null ? DASH : String(n);
}

/**
 * Shared macro display with icons: 🔥 kcal · 🥩 protein · 🍚 carbs · 🧈 fat.
 * Used in history rows (compact) and meal detail (full), so the iconography is
 * consistent everywhere.
 */
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
      <span className="macro">
        <span className="macro-item" title="calories">
          🔥 {fmt(energyKcal)}
        </span>
      </span>
    );
  }
  return (
    <span className="macro">
      <span className="macro-item" title="calories">
        🔥 {fmt(energyKcal)} kcal
      </span>{' '}
      <span className="macro-item" title="protein">
        🥩 {fmt(proteinG)}g
      </span>{' '}
      <span className="macro-item" title="carbs">
        🍚 {fmt(carbsG)}g
      </span>{' '}
      <span className="macro-item" title="fat">
        🧈 {fmt(fatG)}g
      </span>
      {sourceLabel ? <span className="source-tag"> [{sourceLabel}]</span> : null}
    </span>
  );
}
