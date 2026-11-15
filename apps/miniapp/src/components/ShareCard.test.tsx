import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareCard } from './ShareCard.js';

afterEach(cleanup);

const CARD = {
  photoUrl: '/api/meal-photo/m1',
  title: 'Chicken rice bowl',
  calories: 512,
  proteinG: 32,
  carbsG: 61,
  fatG: 14,
};

describe('ShareCard', () => {
  it('renders the title, calories and the three macro values', () => {
    render(<ShareCard {...CARD} />);

    expect(screen.getByText('Chicken rice bowl')).toBeTruthy();
    expect(screen.getByText('512')).toBeTruthy();
    expect(screen.getByText('kcal')).toBeTruthy();
    for (const [label, value] of [
      ['Protein', '32g'],
      ['Carbs', '61g'],
      ['Fat', '14g'],
    ] as const) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(value)).toBeTruthy();
    }
  });

  it('centres every macro value under its label in three equal columns', () => {
    render(<ShareCard {...CARD} />);

    const grid = screen.getByTestId('share-card-macros');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('text-center');

    const columns = ['Protein', 'Carbs', 'Fat'].map((label) => {
      const column = screen.getByText(label).closest('div') as HTMLElement;
      expect(column.className).toContain('text-center');
      const value = within(column).getByText(/^\d+g$/);
      // Tabular numerals keep equal-width values from shifting the columns.
      expect(value.className).toContain('tabular');
      return column;
    });
    // The same classes on every column mean the same track width: the numbers
    // cannot drift left or right of their labels.
    const [protein, carbs, fat] = columns;
    expect(carbs?.className).toBe(protein?.className);
    expect(fat?.className).toBe(protein?.className);
  });

  it('gives the photo the top 60%, cover-cropped, with no meal text over it', () => {
    render(<ShareCard {...CARD} />);

    const photo = screen.getByTestId('share-card-photo');
    expect(photo.className).toContain('h-[60%]');
    // The photo's top corners follow the sheet's radius, so the flush card is
    // not cropped square over the rounded sheet.
    expect(photo.className).toContain('rounded-t-surface');
    const img = screen.getByTestId('share-card-photo-img');
    // One box for frame and image, centre-cropped: a 9:16, 1:1 or 16:9 source
    // fills the frame with no letterboxing and no distortion.
    expect(img.className).toContain('absolute');
    expect(img.className).toContain('inset-0');
    expect(img.className).toContain('size-full');
    expect(img.className).toContain('object-cover');
    expect(img.className).toContain('object-center');
    // The only text over the photo is the wordmark pill.
    expect(photo.textContent).toContain('SnapBite');
    expect(photo.textContent).not.toContain('Chicken rice bowl');
  });

  it('keeps the wordmark pill small and inset from the photo corner', () => {
    render(<ShareCard {...CARD} />);

    const pill = screen.getByTestId('share-card-wordmark');
    expect(pill.className).toContain('top-3');
    expect(pill.className).toContain('left-3');
    expect(pill.className).toContain('max-w-[40%]');
    expect(screen.getByTestId('share-card-photo').querySelector('h3')).toBeNull();
  });

  it('is 4:5, so the card has a fixed shape rather than an arbitrary height', () => {
    render(<ShareCard {...CARD} />);
    expect(screen.getByTestId('share-card').className).toContain('aspect-[4/5]');
  });

  it('sizes every text block against the card, not the viewport', () => {
    render(<ShareCard {...CARD} />);

    const card = screen.getByTestId('share-card');
    // The card is the container the cqw sizes below resolve against.
    expect(card.className).toContain('[container-type:inline-size]');

    expect(screen.getByText('Chicken rice bowl').className).toContain('text-[4.2cqw]');
    expect(screen.getByText('512').className).toContain('text-[7.4cqw]');
    for (const label of ['Protein', 'Carbs', 'Fat']) {
      expect(screen.getByText(label).className).toContain('text-[3.2cqw]');
      expect(screen.getByText(label).className).toContain('whitespace-nowrap');
    }
    for (const value of ['32g', '61g', '14g']) {
      expect(screen.getByText(value).className).toContain('text-[4.2cqw]');
      expect(screen.getByText(value).className).toContain('whitespace-nowrap');
    }
    // 4.5cqw of the 341 px card at 375 pt is 15.3 px; the max() keeps at
    // least 12 px even when a short screen scales the card further down.
    const content = screen.getByText('Chicken rice bowl').parentElement as HTMLElement;
    expect(content.className).toContain('px-[max(12px,4.5cqw)]');
  });

  it('cleans an AI lead-in out of the title', () => {
    render(<ShareCard {...CARD} title="Identified as chicken rice bowl" />);
    expect(screen.getByText('Chicken rice bowl')).toBeTruthy();
  });

  it('renders a plain secondary panel with the wordmark when there is no photo', () => {
    render(<ShareCard {...CARD} photoUrl={null} />);

    const photo = screen.getByTestId('share-card-photo');
    expect(photo.className).toContain('bg-secondary');
    expect(within(photo).getByText('SnapBite')).toBeTruthy();
    // No <img> pointing at the missing photo: the panel is not a broken frame.
    expect(photo.querySelector('img[src^="/api"]')).toBeNull();
    expect(screen.queryByTestId('share-card-photo-img')).toBeNull();
  });
});
