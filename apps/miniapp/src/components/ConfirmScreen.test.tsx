import type { MealResult } from '@foodlog/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmScreen } from './ConfirmScreen.js';

const meal: MealResult = {
  foods: [
    {
      food: { name: 'white rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    },
  ],
  total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
};

describe('ConfirmScreen', () => {
  it('renders foods, total, and the AI-estimate badge', () => {
    render(<ConfirmScreen initial={meal} onSave={() => {}} onRetake={() => {}} />);
    expect(screen.getByText('AI estimate')).toBeInTheDocument();
    expect(screen.getByDisplayValue('white rice')).toBeInTheDocument();
    // 260 kcal shows in both the food row and the total (text split across nodes).
    const has260 = screen.getAllByText((_c, el) =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').includes('260 kcal'),
    );
    expect(has260.length).toBeGreaterThanOrEqual(1);
  });

  it('re-resolves nutrition when the weight is edited', () => {
    render(<ConfirmScreen initial={meal} onSave={() => {}} onRetake={() => {}} />);

    const weight = screen.getByLabelText('Food 1 weight in grams');
    // Set the controlled number input directly to 100g.
    fireEvent.change(weight, { target: { value: '100' } });

    // white rice at 100g -> 130 kcal. Text is split across nodes, so match the
    // element whose combined text content contains "130 kcal".
    const hasKcal = screen.getAllByText((_content, el) =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').includes('130 kcal'),
    );
    expect(hasKcal.length).toBeGreaterThanOrEqual(1);
  });

  it('saves the edited meal', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ConfirmScreen initial={meal} onSave={onSave} onRetake={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as MealResult;
    expect(saved.foods[0]?.food.name).toBe('white rice');
    expect(saved.total.source).toBe('table');
  });

  it('calls onRetake', async () => {
    const user = userEvent.setup();
    const onRetake = vi.fn();
    render(<ConfirmScreen initial={meal} onSave={() => {}} onRetake={onRetake} />);
    await user.click(screen.getByRole('button', { name: 'Retake' }));
    expect(onRetake).toHaveBeenCalledTimes(1);
  });
});
