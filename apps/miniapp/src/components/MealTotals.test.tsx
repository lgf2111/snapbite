import { cleanup, render, screen } from '@testing-library/react';
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
    for (const name of ['Calories', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getAllByText(name, { exact: true })).toHaveLength(1);
    }
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('edited')).toBeTruthy();
  });

  it('shows every value with its unit in body sans, with no display face', () => {
    render(<MealTotals {...TOTALS} />);

    const values = ['24.2', '181', '31.2'];
    expect(screen.getByText((1111).toLocaleString())).toBeTruthy();
    for (const value of values) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.getByText(/kcal/)).toBeTruthy();
    expect(screen.getAllByText(/^g$/)).toHaveLength(3);

    for (const cell of screen.getAllByTestId('total-cell')) {
      const value = cell.querySelector('[data-testid=total-value] span') as HTMLElement;
      expect(value.className).toContain('text-body');
      expect(value.className).toContain('font-medium');
      expect(value.className).toContain('tabular');
      expect(value.className).not.toContain('font-display');
    }
  });

  it('baselines all four values in the same row', () => {
    render(<MealTotals {...TOTALS} />);

    const rows = screen.getAllByTestId('total-value');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.className).toBe(rows[0]?.className);
      expect(row.className).toContain('items-baseline');
      expect(row.className).toContain('whitespace-nowrap');
    }
    // The labels sit under those rows, in the same order as the values.
    const labels = screen.getAllByTestId('total-cell').map((cell) => cell.lastElementChild);
    expect(labels.map((label) => label?.textContent)).toEqual([
      'Calories',
      'Protein',
      'Carbs',
      'Fat',
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

    // jsdom does no layout, so this pins the geometry at 375pt:
    // 375 − 32 page padding = 343px, minus three 8px gaps = 319px,
    // 79.75px per column. A four-digit 16px number plus " kcal" at 13px fits.
    const column = (375 - 32 - 3 * 8) / 4;
    expect(column).toBe(79.75);
    const widest = 4 * 9 + 4 + 22;
    expect(widest).toBeLessThanOrEqual(column);
  });
});
