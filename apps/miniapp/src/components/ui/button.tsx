import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium transition-[transform,background-color,border-color,color] duration-[160ms] ease-[var(--ease-out-quint)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent',
        // Icon-only buttons; a text-labelled tertiary action is `link`.
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'min-h-11 px-3 text-primary-text underline-offset-4 hover:underline focus-visible:underline',
      },
      size: {
        // 44px is the iOS touch floor; `default` meets it rather than sitting
        // under it, so no screen has to add padding to reach the guideline.
        default: 'h-11 px-5 py-2.5 has-[>svg]:px-4',
        sm: 'h-11 gap-1.5 px-3 text-caption has-[>svg]:px-2.5',
        lg: 'h-12 px-6 has-[>svg]:px-5',
        icon: 'size-11',
      },
    },
    compoundVariants: [{ variant: 'link', size: 'default', className: 'h-auto px-3' }],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
