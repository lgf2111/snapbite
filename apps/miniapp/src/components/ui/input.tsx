import { cn } from '@/lib/utils';
import type * as React from 'react';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // The focus outline is drawn inside the field: an outside one can cross
        // whatever sits next to it when a sheet is short on space.
        'flex h-11 w-full min-w-0 rounded-control border border-input bg-transparent px-3 py-1 text-body transition-colors file:inline-flex file:border-0 file:bg-transparent file:text-caption file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
