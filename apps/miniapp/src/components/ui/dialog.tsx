import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type * as React from 'react';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
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
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  // Every dialog can hold a text field, and iOS puts the keyboard over them.
  const keyboardInset = useKeyboardInset();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-card fixed left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 grid-cols-[minmax(0,1fr)] gap-4 max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)] overflow-y-auto overscroll-contain rounded-xl border p-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
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
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5', className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // In flow, never sticky: a pinned footer sits on top of the sheet's
        // content when the keyboard shortens it, and it can cover the field
        // (or its focus ring) directly above it. `flex-col-reverse` keeps the
        // primary action (last in the DOM) on top; text-field dialogs use
        // DialogActions instead.
        'bg-card flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
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
      className={cn('text-lg font-semibold leading-none', className)}
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
      className={cn('text-muted-foreground text-sm', className)}
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
