import { cn } from '@/lib/utils';

export type MacroTone = 'primary' | 'warning' | 'destructive';

interface MacroRowProps {
  label: string;
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
 * One macro under the verdict: label, `120 / 150g`, and a 3px bar.
 *
 * The value text carries the state with a `+` and a screen-reader phrase once
 * over target, so the tone colour is never the only signal; the bar is the
 * length cue and is hidden from assistive tech.
 */
export function MacroRow({ label, have, target, unit, tone }: MacroRowProps) {
  const over = tone !== 'primary';
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
      <dt className="text-muted-foreground text-caption">{label}</dt>
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
