import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * shadcn-style calendar built on react-day-picker v9, themed with the app's
 * design tokens so it follows the Telegram theme. Used inside a Popover.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center justify-between absolute inset-x-0 top-1 px-1',
        button_previous: cn(
          'inline-flex size-7 items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:bg-accent',
        ),
        button_next: cn(
          'inline-flex size-7 items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:bg-accent',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-9 text-center text-[0.7rem] font-normal',
        week: 'flex w-full mt-1',
        day: 'size-9 p-0 text-center text-sm',
        day_button: cn(
          'inline-flex size-9 items-center justify-center rounded-md font-normal hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
        today: '[&>button]:font-semibold [&>button]:text-primary',
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
