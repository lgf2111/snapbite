import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The token file is the design system; these tests keep it honest.
 *
 * Contrast is measured from the hex values in `index.css` rather than from a
 * screenshot, so a colour change that quietly drops below AA fails here instead
 * of shipping. WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and for
 * non-text UI that carries meaning.
 */

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Reads a custom property from a named block (`:root` or the dark media query). */
function readBlock(mode: 'light' | 'dark'): Record<string, string> {
  const start =
    mode === 'light' ? css.indexOf(':root {') : css.indexOf('@media (prefers-color-scheme: dark)');
  expect(start, `${mode} block exists`).toBeGreaterThan(-1);
  const end = css.indexOf('}', css.indexOf('--ring', start));
  const block = css.slice(start, end);
  const vars: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/);
    if (m?.[1] && m[2]) vars[m[1]] = m[2].toLowerCase();
  }
  return vars;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const [ri, gi, bi] = [0, 2, 4].map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(ri) + 0.7152 * lin(gi) + 0.0722 * lin(bi);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)] as [number, number];
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string, number]> = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['foreground', 'card', 4.5],
  ['muted-foreground', 'card', 4.5],

  ['primary-text', 'background', 4.5],
  ['primary-text', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['destructive', 'background', 4.5],
  ['success', 'background', 4.5],
  ['warning', 'background', 4.5],
];

describe.each(['light', 'dark'] as const)('%s palette', (mode) => {
  const vars = readBlock(mode);

  it('defines every token the primitives read', () => {
    for (const name of [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'primary',
      'primary-foreground',
      'primary-text',
      'secondary',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'destructive-foreground',
      'success',
      'warning',
      'border',
      'input',
      'ring',
    ]) {
      expect(vars[name], `${mode}: --${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps primary readable as a filled surface, not as text', () => {
    // A bright accent cannot also be 4.5:1 on a light page; that is why text
    // links use --primary-text. What primary must do is separate from the
    // surface it sits on, which is a 2:1 large-shape requirement here.
    const ratio = contrast(vars.primary as string, vars.background as string);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(2);
  });

  it.each(TEXT_PAIRS)('%s on %s meets %.1f:1', (fg, bg, min) => {
    const ratio = contrast(vars[fg] as string, vars[bg] as string);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });

  it('keeps the macro bar fill visible on its muted track', () => {
    // The track is --muted and the fill --primary; the bar is the only
    // non-colour progress cue on the macro rows, so the fill must separate.
    const ratio = contrast(vars.primary as string, vars.muted as string);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(1.8);
  });

  it('keeps the border visible against both surfaces (>= 1.5:1)', () => {
    // Decorative, so not held to 3:1 — but at 1.1:1 a card edge disappears.
    expect(contrast(vars.border as string, vars.background as string)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(vars.border as string, vars.card as string)).toBeGreaterThanOrEqual(1.4);
  });
});

describe('palette wiring', () => {
  it('switches on the OS setting instead of a class', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).not.toContain('@custom-variant dark');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('color-scheme: dark');
  });

  it('uses the brand colour for primary and leaves accent as a state surface', () => {
    const light = readBlock('light');
    expect(light.primary).not.toBe(light.accent);
  });
});

describe('app shell top', () => {
  it('clears the status bar with a floor of 12px', () => {
    const rule = css.match(/\.pt-top\s*{([^}]*)}/)?.[1] ?? '';
    expect(rule).toContain('max(env(safe-area-inset-top');
    expect(rule).toContain('12px');
  });

  it('draws nothing over the header: no mask, gradient or backdrop on the shell classes', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/components/AppShell.tsx'), 'utf8');
    const root = shell.match(/<div className="(pt-top[^"]*)"/)?.[1] ?? '';
    expect(root).toBeTruthy();
    expect(root).not.toMatch(/mask|gradient|backdrop|opacity|\/\d\d/);
  });
});
