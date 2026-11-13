import { MACRO_ICONS, MACRO_LABELS, type MacroKey } from '@/lib/macroIcons';
import { cn } from '@/lib/utils';

export type MacroTone = 'primary' | 'warning' | 'destructive';

interface MacroRowProps {
  macro: MacroKey;
  have: number;
  target: number;
  unit: string;
  tone: MacroTone;
}

/** Consumed as a 0-1 share of the target, capped at a full bar; a missing target reads as empty. */
const fillRatio = (have: number, target: number) =>
  target > 0 ? Math.min(1, Math.max(0, have / target)) : 0;

const VALUE_TONE: Record<MacroTone, string> = {
  primary: 'text-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

const FILL_TONE: Record<MacroTone, string> = {
  primary: 'bg-primary',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

/**
 * One macro under the verdict: a 16 px glyph column, the value, then a 3 px bar.
 *
 * The fixed first column is what makes the three rows line up: every icon sits
 * at the same x, every value starts at the same x, and every bar spans the full
 * row from the same left edge. The glyph carries the macro's identity, so the
 * name is screen-reader-only and the old P/C/F initials are gone.
 *
 * The value text carries the state with a `+` and a screen-reader phrase once
 * over target, so the tone colour is never the only signal; the bar is the
 * length cue and is hidden from assistive tech.
 */
export function MacroRow({ macro, have, target, unit, tone }: MacroRowProps) {
  const over = tone !== 'primary';
  const Icon = MACRO_ICONS[macro];
  return (
    <div
      data-slot="macro-row"
      data-macro={macro}
      className="grid grid-cols-[1rem_1fr] items-center gap-x-2 gap-y-1"
    >
      <dt className="flex items-center">
        <Icon
          data-testid={`macro-bar-icon-${macro}`}
          className="size-4 stroke-[1.75]"
          aria-hidden
        />
        <span className="sr-only">{MACRO_LABELS[macro]}</span>
      </dt>
      <dd
        data-slot="macro-value"
        data-tone={tone}
        className={cn('tabular text-caption font-medium', VALUE_TONE[tone])}
      >
        {Math.round(have)}
        <span className="text-muted-foreground">
          {' / '}
          {Math.round(target)}
          {unit}
        </span>
        {over && (
          <span data-slot="macro-over" className="ml-0.5 font-semibold">
            +<span className="sr-only"> over target</span>
          </span>
        )}
      </dd>
      <dd
        aria-hidden
        data-slot="macro-bar"
        className="bg-muted ring-border col-span-2 h-[3px] overflow-hidden rounded-none ring-1"
      >
        <div
          data-slot="macro-fill"
          data-tone={tone}
          className={cn(
            'h-full w-full origin-left rounded-none transition-transform duration-500 ease-[var(--ease-out-quint)] motion-reduce:transition-none',
            FILL_TONE[tone],
          )}
          style={{ transform: `scaleX(${fillRatio(have, target)})` }}
        />
      </dd>
    </div>
  );
}
