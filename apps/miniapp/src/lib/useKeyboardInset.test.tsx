import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupLayer } from '../components/SetupLayer.js';
import { keyboardInset, useKeyboardInset } from './useKeyboardInset.js';

const root = () => document.documentElement;
const inset = () => root().style.getPropertyValue('--keyboard-inset');

/** A stand-in for window.visualViewport: jsdom has no layout, so tests drive it by hand. */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    this.listeners += 1;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) {
    this.listeners -= 1;
    super.removeEventListener(...args);
  }
  /** The keyboard comes up (or goes away): the visual viewport changes, then events fire. */
  set(height: number, offsetTop = 0, events: Array<'resize' | 'scroll'> = ['resize']) {
    this.height = height;
    this.offsetTop = offsetTop;
    for (const type of events) this.dispatchEvent(new Event(type));
  }
}

let vv: FakeViewport;
let frames: Array<() => void>;
const flush = () =>
  act(() => {
    const run = frames;
    frames = [];
    for (const f of run) f();
  });

beforeEach(() => {
  vv = new FakeViewport();
  frames = [];
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'visualViewport');
  root().style.removeProperty('--keyboard-inset');
});

function Probe() {
  useKeyboardInset();
  return null;
}

describe('keyboardInset', () => {
  it('is what the visual viewport leaves uncovered below it, never negative', () => {
    expect(keyboardInset({ height: 500, offsetTop: 0 })).toBe(300);
    // Panned down by 40px: the layout viewport's bottom is 40px closer.
    expect(keyboardInset({ height: 500, offsetTop: 40 })).toBe(260);
    expect(keyboardInset({ height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ height: 830, offsetTop: 0 })).toBe(0);
  });
});

describe('useKeyboardInset', () => {
  it('writes --keyboard-inset for a 300px keyboard, and 0 when it goes away', () => {
    render(<Probe />);
    expect(inset()).toBe('0px');

    vv.set(500);
    flush();
    expect(inset()).toBe('300px');

    vv.set(800);
    flush();
    expect(inset()).toBe('0px');
  });

  it('follows scroll events too (the page pans when the keyboard opens)', () => {
    render(<Probe />);
    vv.set(500, 0, ['resize']);
    flush();
    vv.set(500, 120, ['scroll']);
    flush();
    expect(inset()).toBe('180px');
  });

  it('writes once per frame however many events arrive', () => {
    render(<Probe />);
    const set = vi.spyOn(root().style, 'setProperty');
    vv.set(500, 0, ['resize', 'scroll', 'resize', 'scroll']);
    expect(frames).toHaveLength(1);
    flush();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('removes the variable and its listeners on unmount', () => {
    const { unmount } = render(<Probe />);
    vv.set(500);
    flush();
    expect(inset()).toBe('300px');

    unmount();
    expect(inset()).toBe('');
    expect(vv.listeners).toBe(0);
    // And a late event from the old subscription cannot bring it back.
    vv.set(400);
    flush();
    expect(inset()).toBe('');
  });

  it('is shared: closing one sheet does not clear the inset under another', () => {
    const a = render(<Probe />);
    const b = render(<Probe />);
    vv.set(500);
    flush();
    a.unmount();
    expect(inset()).toBe('300px');
    expect(vv.listeners).toBe(2); // one subscription (resize + scroll), not one per sheet
    b.unmount();
    expect(inset()).toBe('');
    expect(vv.listeners).toBe(0);
  });

  it('does nothing where there is no visualViewport', () => {
    Reflect.deleteProperty(window, 'visualViewport');
    const { unmount } = render(<Probe />);
    expect(inset()).toBe('');
    unmount();
  });
});

describe('the sheets that use it', () => {
  it('a dialog publishes the inset while mounted and clears it when it goes', () => {
    const view = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Say something</DialogDescription>
          <textarea aria-label="Your feedback" />
        </DialogContent>
      </Dialog>,
    );
    const panel = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(panel.className).toContain('top-1/2');

    vv.set(500);
    flush();
    expect(inset()).toBe('300px');

    // The panel is sized from the variable and, with the keyboard up, sits
    // directly above it instead of centring in what is left.
    expect(panel.className).toContain('max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)]');
    expect(panel.className).toContain('bottom-[calc(var(--keyboard-inset,0px)+1rem)]');
    expect(panel.className).toContain('top-auto');
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.className).not.toContain('top-1/2');

    view.unmount();
    expect(inset()).toBe('');
  });

  it('the footer stays pinned inside the scrolling panel, so the primary action is reachable', async () => {
    const { DialogFooter } = await import('@/components/ui/dialog');
    render(<DialogFooter data-testid="f">Send</DialogFooter>);
    const cls = (document.querySelector('[data-slot=dialog-footer]') as HTMLElement).className;
    expect(cls).toContain('sticky');
    expect(cls).toContain('bottom-0');
  });

  it('the setup layer publishes it too', () => {
    const view = render(
      <SetupLayer onDismiss={() => {}}>
        <input aria-label="Age" />
      </SetupLayer>,
    );
    vv.set(500);
    flush();
    expect(inset()).toBe('300px');
    view.unmount();
    expect(inset()).toBe('');
  });
});
