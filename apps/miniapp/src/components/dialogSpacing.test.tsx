import type { Backend } from '@/lib/backend';
import type { MealResult } from '@snapbite/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualMealDialog } from './ManualMealDialog.js';
import { SaveMealDialog } from './SaveMealDialog.js';
import { ReviseWithAiDialog } from './UpdateWithAi.js';

/*
 * The three dialogs that hold a text field. jsdom has no layout engine, so the
 * gap is derived from the classes that produce it (1rem = 16px, 3px ring). The
 * sheet is capped at max-w-sm, so 430px wide is 384px in the browser, and the
 * same stack was checked in headless Chrome with a 336px keyboard. A field's
 * outer ring box is its border box plus the ring, unless the ring is inset —
 * which is why every Input/Textarea now uses ring-inset.
 */
const RING_PX = 3;
const VIEWPORT = { width: 430, height: 932 };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: VIEWPORT.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT.height, configurable: true });
  // A 336px keyboard leaves 596px of the 932px viewport.
  Object.defineProperty(window, 'visualViewport', {
    value: Object.assign(new EventTarget(), { height: 596, offsetTop: 0 }),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'visualViewport');
});

const DRAFT: MealResult = {
  foods: [],
  total: { energyKcal: 500, proteinG: 30, carbsG: 60, fatG: 12, source: 'mixed' },
  confidence: 0.9,
  needsConfirmation: false,
};

const backend = {
  mode: 'local' as const,
  reviseDraft: vi.fn(async () => DRAFT),
  listFavorites: vi.fn(async () => []),
} as unknown as Backend;

/** 1rem Tailwind spacing from `gap-2` / `gap-4`, or null when there is none. */
function gapFromClasses(el: Element): number | null {
  const match = el.className.match(/(?:^|\s)gap(?:-[xy])?-(\d+)(?:\s|$)/);
  return match ? Number(match[1]) * 4 : null;
}

function lowestCommonAncestor(a: Element, b: Element): Element | null {
  const chain = new Set<Element>();
  for (let el: Element | null = a; el; el = el.parentElement) chain.add(el);
  for (let el: Element | null = b; el; el = el.parentElement) {
    if (chain.has(el)) return el;
  }
  return null;
}

const FOCUSABLE = 'input:not([type=hidden]), button, textarea, select, a[href], [tabindex]';

/** The next control below the focused field, in reading (DOM) order. */
function nextControl(field: HTMLElement, root: HTMLElement): HTMLElement | null {
  const order = [...root.querySelectorAll<HTMLElement>('*')];
  const position = order.indexOf(field);
  return (
    [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((el) => el !== field && !el.hasAttribute('disabled'))
      .find((el) => order.indexOf(el) > position) ?? null
  );
}

type DialogCase = {
  name: string;
  open: () => Promise<{ field: HTMLElement; root: HTMLElement }>;
};

const cases: DialogCase[] = [
  {
    name: 'Update with AI',
    open: async () => {
      render(
        <ReviseWithAiDialog
          open
          onOpenChange={vi.fn()}
          backend={backend}
          mealId="m1"
          onDraft={vi.fn()}
        />,
      );
      const field = await screen.findByPlaceholderText(/describe the change/i);
      await waitFor(() => expect(document.activeElement).toBe(field));
      return {
        field,
        root: document.querySelector('[data-slot=dialog-content]') as HTMLElement,
      };
    },
  },
  {
    name: 'Save meal',
    open: async () => {
      render(
        <SaveMealDialog
          open
          name="Chicken rice bowl"
          saving={false}
          onNameChange={vi.fn()}
          onOpenChange={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      const field = await screen.findByLabelText('Name');
      await waitFor(() => expect(document.activeElement).toBe(field));
      return {
        field,
        root: document.querySelector('[data-slot=dialog-content]') as HTMLElement,
      };
    },
  },
  {
    name: 'Manual log',
    open: async () => {
      render(<ManualMealDialog backend={backend} open onOpenChange={vi.fn()} onLogged={vi.fn()} />);
      const field = document.getElementById('mm-food') as HTMLElement;
      await waitFor(() => expect(document.activeElement).toBe(field));
      return {
        field,
        root: document.querySelector('[data-slot=dialog-content]') as HTMLElement,
      };
    },
  },
];

describe(`at ${VIEWPORT.width}×${VIEWPORT.height}, a focused field clears the next control`, () => {
  for (const { name, open } of cases) {
    it(`${name}: the ring box leaves at least 8px`, async () => {
      const { field, root } = await open();

      // 430×932 is a 398px sheet capped at max-w-sm (384px), sitting above a
      // 336px keyboard instead of being covered by it.
      expect(root.className).toContain('w-[calc(100%-2rem)]');
      expect(root.className).toContain('max-w-sm');
      expect(root.className).toContain('max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)]');
      expect(root.className).toContain('bottom-[calc(var(--keyboard-inset,0px)+1rem)]');
      expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('336px');

      const next = nextControl(field, root);
      expect(next, `${name} has a control after its field`).not.toBeNull();

      const common = lowestCommonAncestor(field, next as HTMLElement);
      expect(common, `${name}: field and control share a container`).not.toBeNull();
      const gap = gapFromClasses(common as Element);
      expect(gap, `${name}: the container declares its vertical gap`).not.toBeNull();

      // An inset ring stays inside the field; an outside one extends the box.
      const overhang = field.className.includes('ring-inset') ? 0 : RING_PX;
      expect(field.className).toContain('ring-inset');
      expect((gap as number) - overhang).toBeGreaterThanOrEqual(8);

      // No sticky/absolute footer may be painted across that gap.
      for (let el = next?.parentElement; el && el !== root; el = el.parentElement) {
        expect(el.className, `${name}: ${el.className}`).not.toMatch(/\b(sticky|fixed|absolute)\b/);
        expect(el.className, `${name}: ${el.className}`).not.toMatch(/(^|\s)-m[tbyxl]?-/);
      }
    });
  }
});
