import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type VariantProps, cva } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import type * as React from 'react';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

/**
 * `center` floats in the middle; `sheet` is anchored to the bottom edge with
 * square bottom corners and slides up instead of zooming.
 */
const dialogContentVariants = cva(
  'bg-card fixed left-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 grid-cols-[minmax(0,1fr)] gap-4 max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)] overflow-y-auto overscroll-contain border p-5 shadow-lift duration-200 motion-reduce:duration-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  {
    variants: {
      variant: {
        center:
          'max-w-sm rounded-surface data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        sheet:
          'sheet-safe bottom-0 top-auto max-w-md translate-y-0 rounded-t-surface rounded-b-none data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-2',
      },
    },
    defaultVariants: { variant: 'center' },
  },
);

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-[var(--scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  hideClose = false,
  variant,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & { hideClose?: boolean }) {
  // Every dialog can hold a text field, and iOS puts the keyboard over them.
  const keyboardInset = useKeyboardInset();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          dialogContentVariants({ variant }),
          // With the keyboard up, sit directly above it (top edge on screen)
          // instead of centring in the half-dark space that is left.
          keyboardInset > 0
            ? 'top-auto bottom-[calc(var(--keyboard-inset,0px)+1rem)] translate-y-0'
            : 'top-1/2 -translate-y-1/2',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <XIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      // Room for the 44px close button at the top-right of every dialog.
      className={cn('flex flex-col gap-1.5 pr-10', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // In flow, never sticky: a pinned footer sits on top of the sheet's
        // content when the keyboard shortens it, and it can cover the field
        // (or its focus outline) directly above it. Primary first in the DOM
        // and on top.
        'bg-card flex flex-col gap-2',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The standard action stack for a dialog with a field: primary 48px on top,
 * secondary as a text button underneath (a 44px target), 8px apart. The 16px
 * above the block comes from the dialog's `gap-4` (or a footer's `pt-4`), so
 * the field's focus ring always has room. Never make this block sticky.
 */
function DialogActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-actions" className={cn('flex flex-col gap-2', className)} {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-title font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-caption', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
