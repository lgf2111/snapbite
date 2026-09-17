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
}

/**
 * A circular progress ring showing how much of a daily target remains. The ring
 * fills with the consumed fraction; the center shows the remaining amount (or
 * "over by N" when the target is exceeded). Uses currentColor so the caller
 * controls the hue via a text-color class.
 */
export function ProgressRing({
  consumed,
  target,
  label,
  size = 96,
  icon,
  colorClass = 'text-primary',
}: ProgressRingProps) {
  const stroke = Math.max(6, Math.round(size * 0.09));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTarget = target > 0 ? target : 0;
  const fraction = safeTarget > 0 ? Math.min(1, consumed / safeTarget) : 0;
  const over = safeTarget > 0 && consumed > safeTarget;
  const remaining = Math.round(safeTarget - consumed);
  const dashOffset = circumference * (1 - fraction);

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
            className="text-muted/40"
            stroke="currentColor"
          />
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
            style={{ transition: 'stroke-dashoffset 400ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {icon && <span className="text-sm">{icon}</span>}
          <span className={cn('font-bold', size >= 96 ? 'text-lg' : 'text-sm')}>
            {over ? Math.abs(remaining) : Math.max(0, remaining)}
          </span>
          <span className="text-muted-foreground text-[10px]">{over ? 'over' : 'left'}</span>
        </div>
      </div>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}
