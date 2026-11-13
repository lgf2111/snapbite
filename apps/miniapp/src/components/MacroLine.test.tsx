import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MacroLine } from './MacroLine.js';

afterEach(cleanup);

/** The Lucide class is what proves the right glyph, not just a glyph. */
const GLYPH: Record<string, string> = {
  protein: 'lucide-beef',
  carbs: 'lucide-wheat',
  fat: 'lucide-droplet',
  fiber: 'lucide-sprout',
};

describe('MacroLine', () => {
  it('draws one labelled glyph per macro and keeps the number and unit', () => {
    const { container } = render(
      <MacroLine energyKcal={512} proteinG={32} carbsG={41} fatG={12} fiberG={7} />,
    );

    // kcal stays words: no icon for the fact that already names itself.
    expect(screen.getByText('512 kcal').closest('span')?.querySelector('svg')).toBeNull();

    const values: Record<string, string> = {
      protein: '32g',
      carbs: '41g',
      fat: '12g',
      fiber: '7g',
    };
    for (const [macro, text] of Object.entries(values)) {
      const icon = screen.getByTestId(`macro-icon-${macro}`);
      expect(icon.tagName.toLowerCase()).toBe('svg');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.getAttribute('class')).toContain('size-4');
      expect(icon.getAttribute('class')).toContain('stroke-[1.75]');
      expect(icon.getAttribute('class')).toContain(GLYPH[macro]);

      // One icon for one fact, beside its value and its screen-reader name.
      const value = icon.parentElement as HTMLElement;
      expect(value.querySelectorAll('svg')).toHaveLength(1);
      expect(value.textContent).toContain(text);
      expect(within(value).getByText(new RegExp(`^${macro}$`, 'i'))).toBeTruthy();
    }

    expect(container.querySelectorAll('svg')).toHaveLength(4);
  });

  it('keeps the list row to kcal text', () => {
    const { container } = render(<MacroLine energyKcal={512} compact />);

    expect(screen.getByText('512 kcal')).toBeTruthy();
    expect(container.textContent).not.toContain('32g');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('omits fiber when the source did not provide it', () => {
    const { container } = render(
      <MacroLine energyKcal={512} proteinG={32} carbsG={41} fatG={12} />,
    );

    expect(container.textContent).not.toContain('Fiber');
    expect(screen.queryByTestId('macro-icon-fiber')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });
});
