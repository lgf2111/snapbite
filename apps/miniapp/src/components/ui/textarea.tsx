import { cn } from '@/lib/utils';
import type * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Inset for the same reason as Input: never paint the outline on a neighbour.
        'flex min-h-20 w-full rounded-control border border-input bg-transparent px-3 py-2 text-body transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
