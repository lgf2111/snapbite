import { cn } from '@/lib/utils';
import type * as React from 'react';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-secondary animate-pulse motion-reduce:animate-none rounded-control', className)}
      {...props}
    />
  );
}

export { Skeleton };
