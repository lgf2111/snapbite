import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MacroLine } from './MacroLine.js';

afterEach(cleanup);

describe('MacroLine', () => {
  it('names every macro in text and draws no icon', () => {
    const { container } = render(
      <MacroLine energyKcal={512} proteinG={32} carbsG={41} fatG={12} fiberG={7} />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('512 kcal');
    expect(text).toContain('P 32g');
    expect(text).toContain('C 41g');
    expect(text).toContain('F 12g');
    expect(text).toContain('Fiber 7g');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('keeps the list row to kcal text', () => {
    const { container } = render(<MacroLine energyKcal={512} compact />);

    expect(screen.getByText('512 kcal')).toBeTruthy();
    expect(container.textContent).not.toContain('P ');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('omits fiber when the source did not provide it', () => {
    const { container } = render(
      <MacroLine energyKcal={512} proteinG={32} carbsG={41} fatG={12} />,
    );

    expect(container.textContent).not.toContain('Fiber');
  });
});
