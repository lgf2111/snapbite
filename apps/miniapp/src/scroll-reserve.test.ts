import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The camera button floats over the bottom of every screen. These checks do the
 * geometry from the real values (jsdom has no layout): the bar's height from
 * index.css, the reserve token, and how far the button stands above the bar,
 * read from the AppShell classes, rather than from numbers copied into a test.
 *
 * At the end of a scroll the last card's bottom edge sits `reserve` above the
 * bottom of the screen; the button's top edge sits `inset + bar + overhang` above
 * it. Both include the same home-indicator inset, so it cancels.
 */
const REM = 16;
const root = process.cwd();
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
const shell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8');

const barRem = Number(css.match(/--spacing-bar:\s*([\d.]+)rem/)?.[1]);
const reserveDecl = css.match(/--scroll-reserve:\s*([^;]+);/)?.[1] ?? '';
// -top-5 is 5 x 0.25rem above the bar's top.
const overhangRem = Number(shell.match(/absolute -top-(\d+(?:\.\d+)?)\b/)?.[1]) * 0.25;

/** Evaluate the token with a given home-indicator inset (px). */
function reservePx(insetPx: number): number {
  const expr = reserveDecl
    .replace(/^calc\(/, '(')
    .replace('var(--spacing-bar)', String(barRem * REM))
    .replace(/env\(safe-area-inset-bottom[^)]*\)/, String(insetPx))
    .replace(/([\d.]+)rem/g, (_, n) => String(Number(n) * REM));
  expect(expr).toMatch(/^[\d.\s+()]+$/);
  return Function(`"use strict"; return ${expr}`)() as number;
}

describe('--scroll-reserve', () => {
  it('is defined once, from the bar height, plus 3.25rem, plus the bottom inset', () => {
    expect(barRem).toBeGreaterThan(0);
    expect(overhangRem).toBeGreaterThan(0);
    expect(reserveDecl.replace(/\s+/g, ' ').trim()).toBe(
      'calc(var(--spacing-bar) + 3.25rem + env(safe-area-inset-bottom, 0px))',
    );
  });

  it('never drops below the bar plus 44px, whatever the home-indicator inset', () => {
    for (const inset of [0, 20, 34, 47]) {
      expect(reservePx(inset), `inset ${inset}px`).toBeGreaterThanOrEqual(
        barRem * REM + 44 + inset,
      );
    }
  });

  it.each([
    { w: 430, h: 932 },
    { w: 375, h: 667 },
  ])(
    'at $w x $h the last card ends at least 8px above the button, on Home, Settings and meal detail',
    () => {
      // They all scroll inside AppShell's <main>, which carries the reserve.
      for (const inset of [0, 20, 34, 47]) {
        const lastCardFromBottom = reservePx(inset);
        const buttonTopFromBottom = inset + barRem * REM + overhangRem * REM;
        expect(lastCardFromBottom - buttonTopFromBottom, `inset ${inset}px`).toBeGreaterThanOrEqual(
          8,
        );
      }
    },
  );

  it('is what the scroller pads with, and nothing else re-derives it from the bar', () => {
    expect(css).toMatch(/\.reserve-bar\s*{\s*padding-bottom:\s*var\(--scroll-reserve\);?\s*}/);
    expect(shell).toMatch(/<main className="reserve-bar /);

    // No stylesheet or component pads or offsets from the bar height directly any more
    // (the bar's own height, the toast's own token and the AppShell bar itself excepted).
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\./.test(name)) {
          const text = readFileSync(path, 'utf8');
          for (const line of text.split('\n')) {
            if (/(padding-bottom|pb-|bottom:)[^\n]*--spacing-bar/.test(line))
              offenders.push(`${path}: ${line.trim()}`);
          }
        }
      }
    };
    visit(resolve(root, 'src'));
    expect(offenders.filter((o) => !/sonner\.tsx|toastClearance/.test(o))).toEqual([]);
  });

  it('the screens add no bottom padding of their own that would double it', () => {
    for (const file of ['HomeScreen', 'SettingsScreen', 'MealDetailScreen']) {
      const text = readFileSync(resolve(root, `src/components/${file}.tsx`), 'utf8');
      // The root wrapper of each screen.
      const rootLine = text
        .split('\n')
        .find((l) => /className="[^"]*flex[^"]*flex-col[^"]*"/.test(l) && /<div/.test(l));
      expect(rootLine, file).toBeTruthy();
      expect(rootLine, file).not.toMatch(/\bpb-\d/);
    }
  });
});
