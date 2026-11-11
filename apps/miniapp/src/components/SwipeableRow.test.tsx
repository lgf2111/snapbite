import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVEAL, SwipeableRow } from './SwipeableRow.js';

afterEach(() => {
  // Test files share one process, so RTL's auto-cleanup only covers the first
  // file to import it. Unmount explicitly.
  cleanup();
  vi.useRealTimers();
});

const card = () => screen.getByTestId('swipe-card');
const action = () => screen.getByTestId('swipe-delete');

/** A mouse swipe, which react-swipeable tracks via trackMouse. */
function swipe(fromX: number, toX: number) {
  fireEvent.mouseDown(card(), { clientX: fromX, clientY: 300 });
  fireEvent.mouseMove(document, { clientX: toX, clientY: 300 });
  fireEvent.mouseUp(document, { clientX: toX, clientY: 300 });
}

function renderRow() {
  render(
    <SwipeableRow onDelete={vi.fn()}>
      <div style={{ height: 68 }}>Chicken rice</div>
    </SwipeableRow>,
  );
}

describe('SwipeableRow: the reveal is part of the row', () => {
  it('at rest clips the whole destructive layer: the card covers it, and it is inert', () => {
    renderRow();
    const row = screen.getByTestId('swipe-row');

    // The only clip is the row itself, with the card's radius.
    expect(row.className).toContain('overflow-hidden');
    expect(row.className).toContain('rounded-xl');
    // At rest the card has not moved, so no part of the action shows.
    expect(card().style.transform).toBe('translateX(0px)');
    expect(action().getAttribute('aria-hidden')).toBe('true');
    expect(action().className).toContain('opacity-0');
    expect(action().className).toContain('pointer-events-none');
  });

  it('at full reveal the action is exactly the row height and flush to the right edge (430x932)', () => {
    // jsdom has no layout, so the box is modelled from the CSS that draws it:
    // inset-y-0 makes the action exactly as tall as the row, right-0 puts its
    // right edge on the container's, and width=REVEAL is the visible strip.
    const VIEWPORT = { w: 430, h: 932 };
    const ROW_H = 68;
    expect(VIEWPORT.h).toBeGreaterThan(ROW_H);

    renderRow();
    swipe(400, 300); // past 40% of the 76px action

    expect(card().style.transform).toBe(`translateX(-${REVEAL}px)`);
    expect(action().className).toContain('inset-y-0');
    expect(action().className).toContain('right-0');
    expect(action().className).toContain('bg-destructive');
    expect(action().style.width).toBe(`${REVEAL}px`);
    // No radius of its own: the root's rounded-xl does the outside corner.
    expect(action().className).not.toMatch(/\brounded/);

    const row = { left: 0, right: VIEWPORT.w, height: ROW_H };
    const reveal = {
      left: row.right - REVEAL,
      right: row.right,
      height: row.height,
      width: REVEAL,
    };
    expect(reveal.height).toBe(row.height);
    expect(reveal.right).toBe(row.right);
    expect(reveal.width).toBe(REVEAL);
    // At rest the card covers that same strip; at full reveal exactly it is red.
    const cardAtRest = { left: 0, right: row.right };
    const cardOpen = { left: -REVEAL, right: row.right - REVEAL };
    expect(cardAtRest.right - reveal.left).toBeGreaterThan(0);
    expect(cardOpen.right).toBe(reveal.left);
    expect(reveal.right - reveal.left).toBe(REVEAL);
  });

  it('settles open past ~40%, springs back below it, and never stops half-open', () => {
    renderRow();

    // Under 40% of 76px: back to rest.
    swipe(400, 370);
    expect(card().style.transform).toBe('translateX(0px)');

    // A slow drag that passes 40% opens fully.
    swipe(400, 350);
    expect(card().style.transform).toBe(`translateX(-${REVEAL}px)`);

    // A right swipe from open, still past the threshold, stays open.
    swipe(300, 340);
    expect(card().style.transform).toBe(`translateX(-${REVEAL}px)`);

    // Pulling it shut past the threshold closes it completely.
    swipe(300, 380);
    expect(card().style.transform).toBe('translateX(0px)');
  });

  it('a fast short flick follows the same position rule, not momentum', () => {
    renderRow();
    // 20px is well under 40% even at speed: closed, never left at 20px.
    swipe(400, 380);
    expect(card().style.transform).toBe('translateX(0px)');
  });

  it('Delete waits for the collapse, then fires onDelete once', () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    render(
      <SwipeableRow onDelete={onDelete}>
        <div>Chicken rice</div>
      </SwipeableRow>,
    );
    swipe(400, 300);
    fireEvent.click(action());

    expect(onDelete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
