import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushState } from '../lib/push.js';

const lib = vi.hoisted(() => ({
  state: 'default' as PushState,
  pushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock('../lib/push.js', () => ({
  pushState: lib.pushState,
  enablePush: lib.enablePush,
  disablePush: lib.disablePush,
  sendTestPush: lib.sendTestPush,
}));

import { PushReminders } from './PushReminders.js';

const COPY = {
  'needs-install': 'Add SnapBite to your Home Screen first, then turn reminders on here.',
  unsupported: 'This browser can’t show notifications.',
  default: 'Off. Turn it on to get a notification at your reminder times.',
  denied:
    'Notifications are blocked for SnapBite. Allow them in your phone’s Settings, then come back here.',
  granted: 'Notifications are allowed, but this phone isn’t signed up yet. Turn it on to finish.',
  subscribed: 'On for this phone.',
} as const;

async function show(state: PushState) {
  lib.state = state;
  lib.pushState.mockImplementation(async () => lib.state);
  render(<PushReminders />);
  await screen.findByTestId('push-state');
}
const toggle = () => screen.getByRole('switch', { name: 'Reminders on this phone' });

beforeEach(() => {
  for (const f of [lib.pushState, lib.enablePush, lib.disablePush, lib.sendTestPush]) f.mockReset();
});
afterEach(cleanup);

describe('Reminders on this phone', () => {
  it('always says where reminders come from, and that they are not guaranteed', async () => {
    await show('default');
    expect(
      screen.getByText(
        /Reminders arrive as notifications from SnapBite, not from Telegram\. On iPhone they only work once the app is on your Home Screen\./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Not guaranteed: iOS can drop reminders if the app was force-quit or Low Power Mode is on/,
      ),
    ).toBeTruthy();
  });

  it.each(Object.entries(COPY))('%s: one plain line of truth', async (state, line) => {
    await show(state as PushState);
    expect(screen.getByTestId('push-state').textContent).toBe(line);
  });

  it('needs-install is a real state, not an error: the switch is off and disabled', async () => {
    await show('needs-install');
    expect(toggle().hasAttribute('disabled')).toBe(true);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: /send a test/i })).toBeNull();
  });

  it('cannot be switched on when unsupported or denied', async () => {
    await show('unsupported');
    expect(toggle().hasAttribute('disabled')).toBe(true);
    cleanup();
    await show('denied');
    expect(toggle().hasAttribute('disabled')).toBe(true);
  });

  it('turning it on enables push straight from the tap, and shows the new state', async () => {
    await show('default');
    lib.enablePush.mockImplementation(async () => {
      lib.state = 'subscribed';
      return 'subscribed';
    });
    fireEvent.click(toggle());

    await waitFor(() => expect(lib.enablePush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('push-state').textContent).toBe(COPY.subscribed));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('turning it off disables push', async () => {
    await show('subscribed');
    lib.disablePush.mockResolvedValue('granted');
    fireEvent.click(toggle());
    await waitFor(() => expect(lib.disablePush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('push-state').textContent).toBe(COPY.granted));
  });

  it('offers a test notification only once subscribed, and sends it', async () => {
    await show('default');
    expect(screen.queryByRole('button', { name: /send a test notification/i })).toBeNull();
    cleanup();

    await show('subscribed');
    lib.sendTestPush.mockResolvedValue({ delivered: 1 });
    fireEvent.click(screen.getByRole('button', { name: /send a test notification/i }));
    await waitFor(() => expect(lib.sendTestPush).toHaveBeenCalledTimes(1));
  });

  it('puts the person back in the real state when enabling fails', async () => {
    await show('default');
    lib.enablePush.mockRejectedValue(new Error('Notifications are not set up on the server yet.'));
    fireEvent.click(toggle());
    await waitFor(() => expect(lib.enablePush).toHaveBeenCalled());
    // It asked again what the state is, rather than leaving the switch lying.
    await waitFor(() => expect(lib.pushState.mock.calls.length).toBeGreaterThan(1));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });
});
