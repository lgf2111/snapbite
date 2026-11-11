import { cn } from '@/lib/utils';

interface ProgressRingProps {
  /** Amount consumed so far. */
  consumed: number;
  /** Daily target. */
  target: number;
  /** Short label under the number (e.g. "kcal", "protein"). */
  label: string;
  /** Ring diameter in px. */
  size?: number;
  /** Emoji/icon shown above the number. */
  icon?: string;
  /** Tailwind text-color class for the ring stroke + accents. */
  colorClass?: string;
  /** Renders the remaining amount in the display face (the verdict ring). */
  hero?: boolean;
}

/**
 * A circular progress ring showing how much of a target remains.
 *
 * The arc stops at a full circle, but "over" is drawn as a second arc that runs
 * past twelve o'clock instead of being thrown away: the old version clamped the
 * fraction, so 100% and 140% looked identical and the only difference was a hue
 * change. Here the overflow is a visible amount, up to one extra turn, and the
 * centre states the number either way.
 */
export function ProgressRing({
  consumed,
  target,
  label,
  size = 96,
  icon,
  colorClass = 'text-primary',
  hero = false,
}: ProgressRingProps) {
  const stroke = Math.max(6, Math.round(size * 0.09));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTarget = target > 0 ? target : 0;
  const ratio = safeTarget > 0 ? consumed / safeTarget : 0;
  const filled = Math.min(1, ratio);
  const overflow = Math.max(0, Math.min(1, ratio - 1));
  const over = safeTarget > 0 && consumed > safeTarget;
  const remaining = Math.round(safeTarget - consumed);
  const dashOffset = circumference * (1 - filled);

  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className={cn(over ? 'text-destructive' : colorClass)}
          role="img"
          aria-label={`${label}: ${over ? `over by ${Math.abs(remaining)}` : `${remaining} left`}`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="text-muted-foreground/25"
            stroke="currentColor"
          />
          {/* A round cap on a zero-length arc still paints a dot, which reads
              as a rendering fault at the top of an empty ring. */}
          {filled > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={stroke}
              stroke="currentColor"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
              style={{ transition: 'stroke-dashoffset 700ms var(--ease-out-quint)' }}
            />
          )}
          {/* Overflow: a second arc from twelve o'clock, so "over" is a shape. */}
          {overflow > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius - stroke - 3}
              fill="none"
              strokeWidth={Math.max(3, Math.round(stroke * 0.55))}
              stroke="currentColor"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * (radius - stroke - 3)}
              strokeDashoffset={2 * Math.PI * (radius - stroke - 3) * (1 - overflow)}
              transform={`rotate(-90 ${center} ${center})`}
              opacity={0.75}
              style={{ transition: 'stroke-dashoffset 700ms var(--ease-out-quint)' }}
            />
          )}
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center leading-none"
          aria-hidden="true"
        >
          {icon && <span className="text-sm">{icon}</span>}
          <span
            className={cn(
              'tabular',
              hero ? 'font-display text-display' : 'font-semibold',
              !hero && (size >= 96 ? 'text-lg' : 'text-sm'),
            )}
          >
            {over ? Math.abs(remaining) : Math.max(0, remaining)}
          </span>
          <span className={cn('text-muted-foreground', hero ? 'text-caption' : 'text-[10px]')}>
            {hero ? `${label} ${over ? 'over' : 'left'}` : over ? 'over' : 'left'}
          </span>
        </div>
      </div>
      {!hero && <span className="text-muted-foreground text-caption">{label}</span>}
    </div>
  );
}
