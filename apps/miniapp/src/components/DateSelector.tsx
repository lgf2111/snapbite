import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';

// react-day-picker is heavy; only load it when the calendar popover opens.
const Calendar = lazy(() =>
  import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })),
);

interface DateSelectorProps {
  /** Selected day as YYYY-MM-DD. */
  value: string;
  onChange: (date: string) => void;
  /** Days (YYYY-MM-DD) that have meals, marked on the calendar. */
  loggedDates: string[];
  /** Replaces the computed day label (Home passes the weekly range). */
  label?: string;
}

/** Local-midnight Date from a YYYY-MM-DD string (avoids UTC off-by-one). */
function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** YYYY-MM-DD key in local time. */
function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDay(key: string, delta: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + delta);
  return toKey(d);
}

function label(key: string): string {
  const d = fromKey(key);
  const today = toKey(new Date());
  if (key === today) return 'Today';
  if (key === shiftDay(today, -1)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The page heading and date picker: prev/next arrows around an `h1` whose
 * button opens a calendar popover. Days with meals are marked; future days are
 * disabled. It renders the page's only `h1`.
 */
export function DateSelector({
  value,
  onChange,
  loggedDates,
  label: labelOverride,
}: DateSelectorProps) {
  const [open, setOpen] = useState(false);
  const today = toKey(new Date());
  const logged = new Set(loggedDates);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={() => onChange(shiftDay(value, -1))}
      >
        <ChevronLeft className="size-5" />
      </Button>

      <h1 className="text-title min-w-0 flex-1 font-semibold">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="hover:bg-accent flex min-h-11 w-full items-center justify-center gap-1 rounded-control px-2 transition-[background-color,transform] duration-[120ms] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="truncate">{labelOverride ?? label(value)}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto max-w-[calc(100vw-2rem)] p-2"
            align="center"
            collisionPadding={16}
          >
            <Suspense fallback={<Skeleton className="h-[22rem] w-[19.25rem] rounded-control" />}>
              <Calendar
                mode="single"
                selected={fromKey(value)}
                defaultMonth={fromKey(value)}
                disabled={{ after: fromKey(today) }}
                modifiers={{ logged: (d) => logged.has(toKey(d)) }}
                modifiersClassNames={{
                  logged:
                    "relative after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-2.5 after:-translate-x-1/2 after:rounded-none after:bg-primary after:content-['']",
                }}
                onSelect={(d) => {
                  if (d) {
                    onChange(toKey(d));
                    setOpen(false);
                  }
                }}
              />
            </Suspense>
          </PopoverContent>
        </Popover>
      </h1>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        disabled={value >= today}
        onClick={() => onChange(shiftDay(value, 1))}
      >
        <ChevronRight className="size-5" />
      </Button>
    </div>
  );
}
