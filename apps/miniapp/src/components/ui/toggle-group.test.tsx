import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from './toggle-group.js';

const realMatchMedia = window.matchMedia;
function setReduced(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

const group = (value: string) => (
  <ToggleGroup type="single" value={value} onValueChange={() => {}} block aria-label="View">
    <ToggleGroupItem value="a">A</ToggleGroupItem>
    <ToggleGroupItem value="b">B</ToggleGroupItem>
    <ToggleGroupItem value="c">C</ToggleGroupItem>
  </ToggleGroup>
);

const indicator = () =>
  document.querySelector<HTMLElement>('[data-slot="toggle-group-indicator"]') as HTMLElement;
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(100);
  });

beforeEach(() => {
  vi.useFakeTimers();
  setReduced(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
});

describe('ToggleGroup sliding indicator', () => {
  it('is already at the selected position on mount, with no transition applied', () => {
    render(group('b'));
    const el = indicator();
    expect(el.style.transform).toBe('translateX(100%)');
    expect(el.style.transitionDuration).toBe('0s');
    // One third of the inside of the group, so it lines up with the items.
    expect(el.style.width).toBe('calc((100% - 2 * var(--seg-pad)) / 3)');
  });

  it('turns the slide on after the first paint: 220ms on the springy-out curve', () => {
    render(group('a'));
    settle();
    expect(indicator().style.transitionProperty).toContain('transform');
    expect(indicator().style.transitionDuration).toBe('220ms');
    expect(indicator().style.transitionTimingFunction).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('moves to the selected index when the value changes, and keeps its transition', () => {
    const { rerender } = render(group('a'));
    settle();
    expect(indicator().style.transform).toBe('translateX(0%)');

    rerender(group('c'));
    expect(indicator().style.transform).toBe('translateX(200%)');
    expect(indicator().style.transitionDuration).toBe('220ms');

    rerender(group('b'));
    expect(indicator().style.transform).toBe('translateX(100%)');
  });

  it('follows keyboard selection too, since it reads the same state', async () => {
    vi.useRealTimers();
    render(
      <ToggleGroup type="single" defaultValue="a" aria-label="View">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(indicator().style.transform).toBe('translateX(0%)');

    const b = screen.getByRole('radio', { name: 'B' });
    b.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(indicator().style.transform).toBe('translateX(100%)'));

    // ...and back, with the arrow keys moving focus first.
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard(' ');
    await waitFor(() => expect(indicator().style.transform).toBe('translateX(0%)'));
  });

  it('hides the pill when nothing is selected', () => {
    render(group(''));
    expect(indicator().style.opacity).toBe('0');
  });

  it('under reduced motion the position changes with no transition, ever', () => {
    setReduced(true);
    const { rerender } = render(group('a'));
    settle();
    expect(indicator().style.transitionDuration).toBe('0s');

    rerender(group('c'));
    settle();
    expect(indicator().style.transform).toBe('translateX(200%)');
    expect(indicator().style.transitionDuration).toBe('0s');
  });

  it('does not intercept taps, sits under the labels, and keeps the 44px items', () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="single" value="a" onValueChange={onValueChange} aria-label="View">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    const el = indicator();
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    // Shape lives on the indicator; the label keeps weight and colour.
    expect(el.className).toContain('ring-1');
    expect(el.className).toContain('bg-background');

    const items = screen.getAllByRole('radio');
    for (const item of items) {
      expect(item.className).toContain('min-h-[44px]');
      expect(item.className).toContain('relative');
      expect(item.className).toContain('data-[state=on]:font-semibold');
      expect(item.className).not.toContain('data-[state=on]:bg-background');
    }
    // The indicator is the first child, so the (positioned) items paint over it.
    expect(el.nextElementSibling).toBe(items[0]);

    fireEvent.click(items[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('gives the incoming label the same duration as the slide', () => {
    render(group('a'));
    const label = screen.getAllByRole('radio')[0] as HTMLElement;
    expect(label.className).toContain('duration-[220ms]');
    expect(label.className).toContain('ease-[cubic-bezier(0.16,1,0.3,1)]');
  });
});
