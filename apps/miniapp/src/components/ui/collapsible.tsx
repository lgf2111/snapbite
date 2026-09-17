import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Smoothly animates its content open/closed by transitioning a CSS grid row
 * from 0fr to 1fr (works without measuring height). The inner wrapper hides
 * overflow so content clips cleanly while collapsing.
 */
export function Collapsible({ open, children, className }: CollapsibleProps) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-in-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
      aria-hidden={!open}
    >
      <div className={cn('overflow-hidden', open ? 'opacity-100' : 'opacity-0', 'transition-opacity duration-200')}>
        {children}
      </div>
    </div>
  );
}
