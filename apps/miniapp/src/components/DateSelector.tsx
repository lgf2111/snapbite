import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

// react-day-picker is heavy; only load it when the calendar popover opens.
const Calendar = lazy(() =>
  import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })),
);

interface DateSelectorProps {
  /** Selected day as YYYY-MM-DD. */
  value: string;
  onChange: (date: string) => void;
  /** Days (YYYY-MM-DD) that have meals — dotted on the calendar. */
  loggedDates: string[];
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
 * A clickable date selector: prev/next arrows around a pill that opens a
 * calendar popover. Days with meals are dotted; future days are disabled.
 */
export function DateSelector({ value, onChange, loggedDates }: DateSelectorProps) {
  const [open, setOpen] = useState(false);
  const today = toKey(new Date());
  const logged = new Set(loggedDates);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={() => onChange(shiftDay(value, -1))}
      >
        <ChevronLeft className="size-5" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" className="flex-1 gap-2">
            <CalendarDays className="size-4" />
            <span className="font-medium">{label(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="center">
          <Suspense fallback={<Skeleton className="h-64 w-64 rounded-md" />}>
            <Calendar
              mode="single"
              selected={fromKey(value)}
              defaultMonth={fromKey(value)}
              disabled={{ after: fromKey(today) }}
              modifiers={{ logged: (d) => logged.has(toKey(d)) }}
              modifiersClassNames={{
                logged:
                  "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-['']",
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
