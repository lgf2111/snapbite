import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupLayer } from './SetupLayer.js';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function setup(onDismiss = vi.fn()) {
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.append(opener);
  opener.focus();
  const view = render(
    <SetupLayer onDismiss={onDismiss}>
      <button type="button">first</button>
      <button type="button" disabled>
        off
      </button>
      <button type="button">last</button>
    </SetupLayer>,
  );
  return { opener, onDismiss, ...view };
}

describe('SetupLayer', () => {
  it('moves focus in, then returns it to the opener on exit', () => {
    const { opener, unmount } = setup();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab inside the layer, skipping disabled controls', () => {
    const { opener } = setup();
    const [first, last] = [screen.getByText('first'), screen.getByText('last')];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    opener.remove();
  });

  it('dismisses on Escape', () => {
    const { onDismiss, opener } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it('dismisses on Back, and a button exit does not', () => {
    const { onDismiss, opener, unmount } = setup();
    expect(window.history.state?.sbSetup).toBe(true);

    // What the browser does on Back: the entry is popped, then popstate fires.
    window.history.replaceState({}, '');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it('freezes page scroll while open and restores it after', () => {
    const { opener, unmount } = setup();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
    opener.remove();
  });

  it('survives React StrictMode remounting (dev) without reading it as Back', async () => {
    // Earlier tests leave history traversals in flight; let them land first.
    await new Promise((r) => setTimeout(r, 50));
    window.history.replaceState(null, '');
    const onDismiss = vi.fn();
    const push = vi.spyOn(window.history, 'pushState');
    render(
      <StrictMode>
        <SetupLayer onDismiss={onDismiss}>
          <button type="button">x</button>
        </SetupLayer>
      </StrictMode>,
    );
    // Let any queued history traversal settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(window.history.state?.sbSetup).toBe(true);
    // The remount reused the entry the first mount pushed.
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });
});
