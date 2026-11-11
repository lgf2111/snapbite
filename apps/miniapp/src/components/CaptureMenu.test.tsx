import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureMenu } from './CaptureMenu.js';

const realMatchMedia = window.matchMedia;
function setReduced(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function setup(open = true) {
  const trigger = document.createElement('button');
  trigger.textContent = 'camera';
  document.body.append(trigger);
  trigger.focus();
  const triggerRef = { current: trigger };
  const onClose = vi.fn();
  const onPick = vi.fn();
  const ui = (isOpen: boolean) => (
    <CaptureMenu open={isOpen} onClose={onClose} onPick={onPick} triggerRef={triggerRef} />
  );
  const view = render(ui(open));
  return { ...view, trigger, onClose, onPick, rerender: (o: boolean) => view.rerender(ui(o)) };
}

const group = () => screen.getByRole('group', { name: /add a meal, 4 options/i });
const cards = () => within(group()).getAllByRole('button');

beforeEach(() => {
  setReduced(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
  for (const el of document.querySelectorAll('body > button')) el.remove();
});

describe('CaptureMenu', () => {
  it('shows exactly four cards, in reading order, as buttons in one labelled group', () => {
    setup();
    const names = cards().map((c) => c.textContent);
    expect(names).toEqual([
      'Use saved mealsRe-log a favourite',
      'Manually logType it in',
      'Upload imageFrom your photos',
      'Take photoUse the camera',
    ]);
    for (const c of cards()) expect(c.tagName).toBe('BUTTON');
  });

  it('each card reports its own action', () => {
    const { onPick } = setup();
    const expected = ['saved', 'manual', 'upload', 'photo'];
    cards().forEach((card, i) => {
      fireEvent.click(card);
      expect(onPick).toHaveBeenLastCalledWith(expected[i]);
    });
    expect(onPick).toHaveBeenCalledTimes(4);
  });

  it('moves focus to the first card on open', () => {
    setup();
    expect(document.activeElement).toBe(cards()[0]);
  });

  it('Tab cycles inside the menu in both directions', () => {
    setup();
    const [first, , , last] = cards() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Escape closes it and returns focus to the camera button', () => {
    const { onClose, trigger } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('tapping the scrim closes it and returns focus to the camera button', () => {
    const { onClose, trigger } = setup();
    fireEvent.click(screen.getByTestId('capture-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('the browser Back button closes it instead of leaving the page', () => {
    const { onClose } = setup();
    expect(window.history.state?.sbMenu).toBe(true);

    // What Back does: our entry is popped, then popstate fires.
    window.history.replaceState({}, '');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the camera button when the parent closes it (e.g. Back won the race)', () => {
    const { rerender, trigger } = setup();
    expect(document.activeElement).toBe(cards()[0]);
    rerender(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus back after a card was chosen', () => {
    const { rerender, trigger } = setup();
    fireEvent.click(cards()[3] as HTMLElement);
    // Something else (a file picker or dialog) now owns focus.
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    rerender(false);
    expect(document.activeElement).not.toBe(trigger);
    other.remove();
  });

  it('is not rendered at all while closed', () => {
    setup(false);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByTestId('capture-scrim')).toBeNull();
  });
});

describe('CaptureMenu motion', () => {
  it('starts every card at the button, small and transparent, then staggers them out', async () => {
    vi.useFakeTimers();
    const { rerender } = setup(false);
    rerender(true);

    // Start pose: scaled down and invisible.
    for (const c of cards()) {
      expect(c.style.opacity).toBe('0');
      expect(c.style.transform).toContain('scale(0.6)');
      expect(c.style.pointerEvents).toBe('none');
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // End pose, with a stagger in reading order.
    for (const c of cards()) {
      expect(c.style.opacity).toBe('1');
      expect(c.style.transform).toBe('none');
    }
    expect(cards().map((c) => c.style.transitionDelay)).toEqual(['0ms', '25ms', '50ms', '75ms']);
    expect(cards()[0]?.style.transitionDuration).toContain('220ms');
  });

  it('closing plays backwards first: still mounted, then gone; nothing snaps shut', async () => {
    vi.useFakeTimers();
    const { rerender } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    rerender(false);
    // Mid-close: cards are back at the start pose but still in the document.
    expect(cards()[0]?.style.opacity).toBe('0');
    expect(cards()[0]?.style.pointerEvents).toBe('none');
    // Closing runs in reverse order.
    expect(cards().map((c) => c.style.transitionDelay)).toEqual(['60ms', '40ms', '20ms', '0ms']);
    expect(screen.queryByRole('group')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('under reduced motion appears and disappears at once, with no transitions', () => {
    setReduced(true);
    const { rerender } = setup(true);

    for (const c of cards()) {
      expect(c.style.opacity).toBe('1');
      expect(c.style.transform).toBe('none');
      expect(c.style.transitionProperty).toBe('none');
    }
    rerender(false);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
