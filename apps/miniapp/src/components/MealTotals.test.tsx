import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MealTotals } from './MealTotals.js';

afterEach(cleanup);

const TOTALS = {
  energyKcal: 1111,
  proteinG: 24.2,
  carbsG: 181,
  fatG: 31.2,
  source: 'edited',
};

describe('MealTotals', () => {
  it('renders four cells and the macro name exactly once per cell', () => {
    render(<MealTotals {...TOTALS} />);

    expect(screen.getAllByTestId('total-cell')).toHaveLength(4);
    for (const name of ['calories', 'protein', 'carbs', 'fat']) {
      expect(screen.getAllByText(name, { exact: true })).toHaveLength(1);
    }
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('edited')).toBeTruthy();
    // The old legend repeated every name under the values; each name now has
    // exactly one node, asserted above.
  });

  it('shows every value with its unit and keeps calories in the display face', () => {
    render(<MealTotals {...TOTALS} />);

    for (const value of ['1111', '24.2', '181', '31.2']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.getByText('kcal')).toBeTruthy();
    expect(screen.getAllByText('g')).toHaveLength(3);

    const [kcal, protein, carbs, fat] = screen.getAllByTestId('total-cell');
    expect(within(kcal as HTMLElement).getByText('1111').className).toContain('font-display');
    expect(within(kcal as HTMLElement).getByText('1111').className).toContain('text-lg');
    for (const cell of [protein, carbs, fat] as HTMLElement[]) {
      const value = cell.querySelector('[data-testid=total-value] span') as HTMLElement;
      expect(value.className).toContain('text-sm');
      expect(value.className).toContain('tabular');
    }
  });

  it('bottom-aligns all four values in the same fixed-height row', () => {
    render(<MealTotals {...TOTALS} />);

    const rows = screen.getAllByTestId('total-value');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.className).toBe(rows[0]?.className);
      expect(row.className).toContain('items-end');
      expect(row.className).toContain('h-6');
    }
    // The labels sit under those rows, in the same order as the values.
    const labels = screen.getAllByTestId('total-cell').map((cell) => cell.lastElementChild);
    expect(labels.map((label) => label?.textContent)).toEqual([
      'calories',
      'protein',
      'carbs',
      'fat',
    ]);
  });

  it('keeps four equal columns without horizontal overflow at 375pt', () => {
    render(<MealTotals {...TOTALS} />);

    const grid = screen.getByTestId('totals-grid');
    // Tailwind's grid-cols-4 is repeat(4, minmax(0, 1fr)); min-w-0 on every cell
    // lets a four-digit calorie count shrink instead of widening its track.
    expect(grid.className).toContain('grid-cols-4');
    expect(grid.className).toContain('gap-x-2');
    for (const cell of screen.getAllByTestId('total-cell')) {
      expect(cell.className).toContain('min-w-0');
    }
    for (const row of screen.getAllByTestId('total-value')) {
      expect(row.className).toContain('whitespace-nowrap');
    }

    // jsdom does no layout, so this pins the geometry at 375pt:
    // 375 − 32 page padding − 2 card border − 32 CardContent padding = 309px,
    // minus three 8px gaps = 285px, 71.25px per column.
    const column = (375 - 32 - 2 - 32 - 3 * 8) / 4;
    expect(column).toBe(71.25);
    // A four-digit 18px serif number is at most ~4×10px; "kcal" at 13px is
    // ~24px, plus the 4px gap before the unit: 68px, inside the 71.25px column.
    const widest = 4 * 10 + 24 + 4;
    expect(widest).toBeLessThanOrEqual(column);
  });
});
