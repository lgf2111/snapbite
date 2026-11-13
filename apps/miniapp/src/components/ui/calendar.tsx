import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * shadcn-style calendar built on react-day-picker v9, themed with the app's
 * design tokens so it follows the Telegram theme. Used inside a Popover.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-11 items-center justify-center',
        caption_label: 'text-body font-medium',
        nav: 'flex items-center justify-between absolute inset-x-0 top-0 px-1',
        button_previous: cn(
          'inline-flex size-11 items-center justify-center rounded-control opacity-70 transition-[transform,background-color,opacity] duration-[120ms] hover:opacity-100 hover:bg-accent active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        ),
        button_next: cn(
          'inline-flex size-11 items-center justify-center rounded-control opacity-70 transition-[transform,background-color,opacity] duration-[120ms] hover:opacity-100 hover:bg-accent active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-11 text-center text-caption font-normal',
        week: 'flex w-full mt-1',
        day: 'size-11 p-0 text-center text-body',
        day_button: cn(
          'inline-flex size-11 items-center justify-center rounded-control font-normal transition-[transform,background-color,color] duration-[120ms] active:scale-[0.97] motion-reduce:active:scale-100 hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        ),
        // The selected day is the one filled pill, and owns its text colour. Today
        // is marked with an inset ring and weight only: it sets no text colour, so
        // the day that is both (usually) cannot end up with primary text on a
        // primary fill, which two competing `text-*` utilities did.
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today:
          '[&>button]:font-semibold [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary-text',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
      }}
      {...props}
    />
  );
}
