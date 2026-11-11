import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';
import { TOAST_BOTTOM, TOAST_OFFSET } from './ui/sonner.js';

/**
 * A toast must never land on the camera button. jsdom has no layout, so this
 * does the geometry from the real values instead of by eye: the toast's bottom
 * offset (the token), the tab bar height (index.css), and how far the button
 * stands above the bar (its `-top-N` class in AppShell). Everything is anchored
 * to the bottom of the screen, so the screen size does not enter into it; the two
 * sizes below are here so the sentence in the test name stays checkable.
 */
const REM = 16;
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const barRem = Number(css.match(/--spacing-bar:\s*([\d.]+)rem/)?.[1]);

function buttonOverhangPx(): number {
  render(
    <AppShell
      active="home"
      onNavigate={vi.fn()}
      menuOpen={false}
      onToggleMenu={vi.fn()}
      captureRef={createRef<HTMLButtonElement>()}
    >
      <p>x</p>
    </AppShell>,
  );
  const button = screen.getByRole('button', { name: /add a meal/i });
  // Tailwind's spacing scale: -top-5 is -5 x 0.25rem.
  const step = Number(button.className.match(/(?:^|\s)-top-(\d+(?:\.\d+)?)(?:\s|$)/)?.[1]);
  cleanup();
  return step * 0.25 * REM;
}

/** Evaluate a `calc(var(--spacing-bar) + Nrem + env(safe-area-inset-bottom, 0px))` token. */
function evaluate(token: string, insetPx: number): number {
  const expr = token
    .replace('calc(', '(')
    .replace('var(--spacing-bar)', `${barRem * REM}`)
    .replace(/env\(safe-area-inset-bottom[^)]*\)/, `${insetPx}`)
    .replace(/([\d.]+)rem/g, (_, n) => `${Number(n) * REM}`);
  // Only digits, spaces, + and parentheses are left; nothing else to evaluate.
  expect(expr).toMatch(/^[\d.\s+()]+$/);
  return Function(`"use strict"; return ${expr}`)() as number;
}

afterEach(cleanup);

describe('toast clears the camera button', () => {
  it('reads the geometry it depends on', () => {
    expect(barRem).toBeGreaterThan(0);
    expect(buttonOverhangPx()).toBeGreaterThan(0);
    expect(TOAST_OFFSET.bottom).toBe(TOAST_BOTTOM);
  });

  it.each([
    { w: 430, h: 932 },
    { w: 375, h: 667 },
  ])(
    'at $w x $h the toast bottom is at least 8px above the button top, with or without a home-indicator inset',
    () => {
      const overhang = buttonOverhangPx();
      for (const inset of [0, 20, 34, 47]) {
        // Heights above the bottom of the screen.
        const toastBottom = evaluate(TOAST_BOTTOM, inset);
        const buttonTop = inset + barRem * REM + overhang;
        expect(toastBottom - buttonTop, `inset ${inset}px`).toBeGreaterThanOrEqual(8);
      }
    },
  );

  it('would have failed with the old bar + 12px', () => {
    const overhang = buttonOverhangPx();
    const old = 'calc(var(--spacing-bar) + env(safe-area-inset-bottom, 0px) + 12px)';
    const oldBottom = old
      .replace('var(--spacing-bar)', `${barRem * REM}`)
      .replace(/env\([^)]*\)/, '0')
      .replace('calc(', '(')
      .replace('12px', '12');
    const gap = (Function(`return ${oldBottom}`)() as number) - (barRem * REM + overhang);
    expect(gap).toBeLessThan(8);
  });
});
