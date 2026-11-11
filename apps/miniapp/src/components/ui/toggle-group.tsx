import { cn } from '@/lib/utils';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

/**
 * Segmented control, built once.
 *
 * Two screens hand-rolled this (the Daily/Weekly toggle and the Total/Average
 * toggle) with slightly different padding, so they drifted. Radix gives the
 * keyboard model and `aria-pressed` semantics; the item is the only thing that
 * knows about selected state.
 */
const toggleGroupVariants = cva(
  'inline-flex items-center justify-center rounded-md bg-muted text-muted-foreground',
  {
    variants: {
      size: {
        // The ROOT carries the height; the item must still clear 44 on its own,
        // so the padding is subtracted here rather than left to chance.
        default: 'h-[52px] p-1',
        sm: 'h-11 p-0.5',
      },
      block: {
        true: 'flex w-full',
        false: '',
      },
    },
    defaultVariants: { size: 'default', block: false },
  },
);

const toggleGroupItemVariants = cva(
  'inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-caption font-medium whitespace-nowrap transition-[transform,background-color,color,box-shadow] duration-[180ms] ease-[var(--ease-out-quint)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-primary-text/50 data-[state=on]:shadow-xs',
  {
    variants: {
      size: {
        default: 'min-h-[44px]',
        sm: 'min-h-10 px-2',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

function ToggleGroup({
  className,
  size,
  block,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleGroupVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(toggleGroupVariants({ size, block }), className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants, toggleGroupVariants };
