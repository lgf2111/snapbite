import { cn } from '@/lib/utils';
import type * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Inset for the same reason as Input: never paint the ring on a neighbour.
        'flex min-h-20 w-full rounded-control border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
