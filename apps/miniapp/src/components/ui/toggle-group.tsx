import { cn } from '@/lib/utils';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

/**
 * Segmented control, built once.
 *
 * Two screens hand-rolled this (the Daily/Weekly toggle and the Total/Average
 * toggle) with slightly different padding, so they drifted. Radix gives the
 * keyboard model and `aria-pressed` semantics; the item is the only thing that
 * knows about selected state.
 */
const toggleGroupVariants = cva(
  'relative inline-flex items-center justify-center rounded-md bg-muted text-muted-foreground',
  {
    variants: {
      size: {
        // The ROOT carries the height; the item must still clear 44 on its own,
        // so the padding is subtracted here rather than left to chance.
        // `--seg-pad` is that padding, shared with the sliding indicator.
        default: 'h-[52px] p-1 [--seg-pad:0.25rem]',
        sm: 'h-11 p-0.5 [--seg-pad:0.125rem]',
      },
      block: {
        true: 'flex w-full',
        false: '',
      },
    },
    defaultVariants: { size: 'default', block: false },
  },
);

/**
 * The item carries only the label: its colour and weight. The shape of the
 * selected segment (fill, ring, shadow) belongs to the sliding indicator, so
 * the highlight can travel between segments instead of swapping.
 */
const toggleGroupItemVariants = cva(
  'relative inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-caption font-medium whitespace-nowrap transition-[transform,color] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:font-semibold data-[state=on]:text-foreground',
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

/** The indicator's slide: same duration and curve as the label colour. */
const SLIDE_MS = 220;
const SLIDE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

function ToggleGroup({
  className,
  size,
  block,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleGroupVariants>) {
  const root = React.useRef<HTMLDivElement>(null);
  const indicator = React.useRef<HTMLSpanElement>(null);
  const single = props.type === 'single';

  /**
   * Put the indicator under the selected item. Written straight to the element,
   * not through React state: it is read from the DOM's own `data-state`, so it
   * follows every way the selection can change (taps, arrow keys, Home/End,
   * programmatic) and costs no render.
   */
  const sync = React.useCallback(() => {
    const rootEl = root.current;
    const el = indicator.current;
    if (!rootEl || !el) return;
    const items = [...rootEl.querySelectorAll('[data-slot="toggle-group-item"]')];
    const index = items.findIndex((item) => item.getAttribute('data-state') === 'on');
    el.style.width = `calc((100% - 2 * var(--seg-pad)) / ${Math.max(items.length, 1)})`;
    el.style.transform = `translateX(${Math.max(index, 0) * 100}%)`;
    // Nothing selected (a single group can be emptied): no pill.
    el.style.opacity = index < 0 ? '0' : '1';
  }, []);

  // Before first paint: sit at the final position with no transition, so the
  // control does not fall into place on every page load. Also re-sync after
  // every render, which covers controlled value changes.
  React.useLayoutEffect(() => {
    const el = indicator.current;
    if (el && !el.style.transitionDuration) {
      el.style.transitionProperty = 'transform, opacity';
      el.style.transitionDuration = '0s';
    }
    sync();
  });

  // Turn the slide on once the first position has been painted. Under reduced
  // motion it never turns on: the position just changes.
  React.useEffect(() => {
    const el = indicator.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reduced) return;
    const frame = requestAnimationFrame(() => {
      el.style.transitionProperty = 'transform, opacity';
      el.style.transitionDuration = `${SLIDE_MS}ms`;
      el.style.transitionTimingFunction = SLIDE_EASE;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Selection that changes inside Radix (uncontrolled groups) never re-renders us.
  React.useEffect(() => {
    const rootEl = root.current;
    if (!rootEl) return;
    const observer = new MutationObserver(sync);
    observer.observe(rootEl, { attributes: true, attributeFilter: ['data-state'], subtree: true });
    return () => observer.disconnect();
  }, [sync]);

  return (
    <ToggleGroupPrimitive.Root
      ref={root}
      data-slot="toggle-group"
      className={cn(toggleGroupVariants({ size, block }), className)}
      {...props}
    >
      {single && (
        // Under the labels, never in the way of a tap. Carries the segment's
        // shape: fill, hairline ring, shadow.
        <span
          ref={indicator}
          aria-hidden="true"
          data-slot="toggle-group-indicator"
          className="pointer-events-none absolute inset-y-[var(--seg-pad)] left-[var(--seg-pad)] rounded-sm bg-background shadow-xs ring-1 ring-primary-text/50"
        />
      )}
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
