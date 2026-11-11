import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

afterEach(cleanup);

function setup(menuOpen: boolean) {
  const onToggleMenu = vi.fn();
  const captureRef = createRef<HTMLButtonElement>();
  render(
    <AppShell
      active="home"
      onNavigate={vi.fn()}
      menuOpen={menuOpen}
      onToggleMenu={onToggleMenu}
      captureRef={captureRef}
    >
      <p>content</p>
    </AppShell>,
  );
  return { onToggleMenu, captureRef };
}

describe('AppShell camera button', () => {
  it('is the add-a-meal button while closed, and exposes itself as the origin ref', () => {
    const { onToggleMenu, captureRef } = setup(false);
    const button = screen.getByRole('button', {
      name: /add a meal — tap for options, hold and slide to choose/i,
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(captureRef.current).toBe(button);
    fireEvent.click(button);
    expect(onToggleMenu).toHaveBeenCalledTimes(1);
  });

  it('becomes a quiet ×, rotated 45 degrees, while the menu is open', () => {
    setup(true);
    const button = screen.getByRole('button', { name: 'Close add-meal menu' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.className).toContain('bg-card');
    expect(button.className).not.toContain('bg-primary');
    expect(button.querySelector('span')?.className).toContain('rotate-45');
  });
});

describe('AppShell while a photo batch uploads', () => {
  const batch = (status: string | null) =>
    render(
      <AppShell
        active="home"
        onNavigate={vi.fn()}
        menuOpen={false}
        onToggleMenu={vi.fn()}
        captureRef={createRef<HTMLButtonElement>()}
        captureStatus={status}
      >
        <p>content</p>
      </AppShell>,
    );

  it('shows the progress under the button and disables it', () => {
    batch('Uploading 2 of 4');
    expect(screen.getByRole('status').textContent).toBe('Uploading 2 of 4');
    const button = screen.getByRole('button', { name: /add a meal/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('is the normal button, with no status line, when nothing is running', () => {
    batch(null);
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /add a meal/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
