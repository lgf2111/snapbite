import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Calendar } from './calendar.js';

afterEach(cleanup);

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function tokens(mode: 'light' | 'dark'): Record<string, string> {
  const start =
    mode === 'light' ? css.indexOf(':root {') : css.indexOf('@media (prefers-color-scheme: dark)');
  const block = css.slice(start, css.indexOf('}', css.indexOf('--ring', start)));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return out;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The text and background colour utilities that style the day's button from its cell. */
function colourUtilities(cell: Element) {
  const own = cell.className.split(/\s+/);
  const text = own.filter((c) => /^\[&>button\]:(?!hover:)text-/.test(c));
  const bg = own.filter((c) => /^\[&>button\]:(?!hover:)bg-/.test(c));
  return { text, bg };
}

describe('the selected day', () => {
  // 12 Nov 2026 is both today and the selected day: the case that went invisible.
  const today = new Date(2026, 10, 12);
  const renderMonth = (selected: Date) =>
    render(<Calendar mode="single" selected={selected} defaultMonth={today} today={today} />);

  it('has exactly one text colour, and it is the on-fill one', () => {
    const { container } = renderMonth(today);
    const cell = container.querySelector('[aria-selected="true"]') as Element;
    expect(cell.querySelector('button')?.textContent).toBe('12');
    // Two competing `text-*` utilities on one cell is how primary-on-primary happened.
    expect(colourUtilities(cell).text).toEqual(['[&>button]:text-primary-foreground']);
    expect(colourUtilities(cell).bg).toEqual(['[&>button]:bg-primary']);
  });

  it.each(['light', 'dark'] as const)(
    '%s: its text is not its background and the pair meets 4.5:1',
    (mode) => {
      const { container } = renderMonth(today);
      const cell = container.querySelector('[aria-selected="true"]') as Element;
      const t = tokens(mode);
      const name = (list: string[], prefix: string) =>
        (list[0] as string).replace(`[&>button]:${prefix}-`, '');
      const text = t[name(colourUtilities(cell).text, 'text')] as string;
      const bg = t[name(colourUtilities(cell).bg, 'bg')] as string;
      expect(text).toBeTruthy();
      expect(bg).toBeTruthy();
      expect(text).not.toBe(bg);
      expect(ratio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("today's cell", () => {
  const today = new Date(2026, 10, 12);

  it('is marked apart from the selected day when another day is selected', () => {
    const { container } = render(
      <Calendar
        mode="single"
        selected={new Date(2026, 10, 5)}
        defaultMonth={today}
        today={today}
      />,
    );
    const todayCell = container.querySelector('[data-today="true"]') as Element;
    const selectedCell = container.querySelector('[aria-selected="true"]') as Element;
    expect(todayCell.querySelector('button')?.textContent).toBe('12');
    expect(selectedCell.querySelector('button')?.textContent).toBe('5');
    // Today carries its own marker (a ring), the selected day carries the fill.
    expect(todayCell.className).toContain('[&>button]:ring-1');
    expect(todayCell.className).not.toContain('bg-primary');
    expect(selectedCell.className).toContain('[&>button]:bg-primary');
    expect(selectedCell.className).not.toContain('ring-1');
  });
});
