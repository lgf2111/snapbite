import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetInstallState } from '../lib/install.js';
import { InstallGuide } from './InstallGuide.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const KEY = 'snapbite.install-guide.v1';
const DAY = 24 * 60 * 60 * 1000;

const realMatchMedia = window.matchMedia;
let standaloneMatches = false;

function setUa(ua: string, touch = 5) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  standaloneMatches = false;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return standaloneMatches && q.includes('standalone');
    },
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  resetInstallState();
});

afterEach(() => {
  // Drop the per-test overrides so later files see jsdom's own navigator.
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  cleanup();
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
});

describe('InstallGuide', () => {
  it('renders nothing on desktop', () => {
    setUa(WINDOWS, 0);
    render(<InstallGuide />);
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });

  it('renders nothing when already running as an installed app', () => {
    setUa(IPHONE);
    standaloneMatches = true;
    render(<InstallGuide />);
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });

  it('teaches iPhone the real Safari steps, with no install button', () => {
    setUa(IPHONE);
    render(<InstallGuide />);
    expect(screen.getByText(/Tap the Share button at the bottom of Safari/)).toBeTruthy();
    expect(screen.getByText(/square with an arrow pointing up/)).toBeTruthy();
    expect(screen.getByText(/tap Add to Home Screen, then Add/)).toBeTruthy();
    expect(screen.getByText(/camera opens straight from the icon/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^install app$/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/press and hold/i);
  });

  it('gives Android the menu steps when Chrome has offered no prompt', () => {
    setUa(ANDROID);
    render(<InstallGuide />);
    expect(screen.getByText(/Open the ⋮ menu in the top-right of Chrome/)).toBeTruthy();
    expect(screen.getByText(/some phones say Add to Home screen/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^install app$/i })).toBeNull();
  });

  it('on Android with a captured prompt, the button prompts and the menu steps become the "or"', async () => {
    setUa(ANDROID);
    render(<InstallGuide />);
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText(/Or open the ⋮ menu/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^install app$/i }));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    // Single-use: after prompting, only the menu steps remain.
    expect(screen.queryByRole('button', { name: /^install app$/i })).toBeNull();
    expect(screen.getByText(/Open the ⋮ menu/)).toBeTruthy();
  });

  it('goes away when the browser reports appinstalled', async () => {
    setUa(ANDROID);
    render(<InstallGuide />);
    expect(screen.getByTestId('install-guide')).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });

  it('shows expanded the first time, then as a collapsed row', () => {
    setUa(IPHONE);
    render(<InstallGuide />);
    expect(screen.getByText(/Tap the Share button/)).toBeTruthy();
    cleanup();

    render(<InstallGuide />);
    expect(screen.getByTestId('install-guide')).toBeTruthy();
    expect(screen.queryByText(/Tap the Share button/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /install snapbite on your phone/i }));
    expect(screen.getByText(/Tap the Share button/)).toBeTruthy();
  });

  it('hides for 14 days after dismissal, then comes back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
    setUa(IPHONE);
    render(<InstallGuide />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install tip' }));
    expect(screen.queryByTestId('install-guide')).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').until).toBe(Date.now() + 14 * DAY);
    cleanup();

    vi.advanceTimersByTime(14 * DAY - 1000);
    render(<InstallGuide />);
    expect(screen.queryByTestId('install-guide')).toBeNull();
    cleanup();

    vi.advanceTimersByTime(1000);
    render(<InstallGuide />);
    expect(screen.getByTestId('install-guide')).toBeTruthy();
  });
});
