import { PROVIDER_PRESETS } from '@snapbite/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../lib/backend.js';
import { ExternalLink } from './ExternalLink.js';
import { LinkifiedHint } from './LinkifiedHint.js';
import { OnboardingScreen } from './OnboardingScreen.js';

const HOSTS = [
  'https://aistudio.google.com/apikey',
  'https://console.cloud.google.com/projectcreate',
  'https://ai.google.dev/gemini-api/docs/api-key',
];

const realMatchMedia = window.matchMedia;
const clipboard = { writeText: vi.fn(async () => {}) };

function setStandalone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('standalone'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}
const withClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

beforeEach(() => {
  clipboard.writeText = vi.fn(async () => {});
  withClipboard(clipboard);
  setStandalone(false);
});
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(window, 'Telegram');
});

describe('ExternalLink in a normal browser tab', () => {
  it('is an anchor that opens a new tab, with no copy step', () => {
    render(<ExternalLink href={HOSTS[0] as string}>Open AI Studio</ExternalLink>);
    const a = screen.getByRole('link', { name: 'Open AI Studio' });
    expect(a.getAttribute('href')).toBe(HOSTS[0]);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ExternalLink in the installed app (standalone)', () => {
  beforeEach(() => setStandalone(true));

  it.each(HOSTS)('%s is a copy control, never a bare anchor, with the address visible', (href) => {
    const { container } = render(<ExternalLink href={href}>Get a key</ExternalLink>);

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
    const button = screen.getByRole('button', {
      name: new RegExp(`copy link to ${new URL(href).host}`, 'i'),
    });
    expect(button.textContent).toContain('Get a key');
    // The address is printed, in monospace, selectable and allowed to wrap anywhere.
    const code = container.querySelector('code') as HTMLElement;
    expect(code.textContent).toBe(href);
    expect(code.className).toContain('font-mono');
    expect(code.className).toContain('select-all');
    expect(code.className).toContain('[overflow-wrap:anywhere]');
  });

  it('one tap copies the address and shows both instruction lines inline', async () => {
    render(<ExternalLink href={HOSTS[0] as string}>Get a key</ExternalLink>);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(HOSTS[0]));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Copied. Paste it into Safari.')).toBeTruthy();
    expect(status.textContent).toMatch(/tap the compass icon at the bottom-right to open Safari/);
    // Inline, not a modal: nothing blocks the page.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('falls back to the visible address when the clipboard refuses, and selects it', async () => {
    clipboard.writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    withClipboard(clipboard);
    const { container } = render(<ExternalLink href={HOSTS[0] as string}>Get a key</ExternalLink>);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/couldn.t copy/i);
    expect(status.textContent).toMatch(/press and hold the address/i);
    expect((container.querySelector('code') as HTMLElement).textContent).toBe(HOSTS[0]);
    expect(window.getSelection()?.toString()).toBe(HOSTS[0]);
  });

  it('falls back the same way when there is no Clipboard API at all', async () => {
    withClipboard(undefined);
    render(<ExternalLink href={HOSTS[0] as string}>Get a key</ExternalLink>);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect((await screen.findByRole('status')).textContent).toMatch(/couldn.t copy/i);
  });

  it('closes the instructions on any tap outside, and keeps the address', async () => {
    const { container } = render(
      <div>
        <ExternalLink href={HOSTS[0] as string}>Get a key</ExternalLink>
        <p>elsewhere</p>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await screen.findByRole('status');

    fireEvent.pointerDown(screen.getByText('elsewhere'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(container.querySelector('code')?.textContent).toBe(HOSTS[0]);
  });

  it('keeps Telegram on its own hand-off: still an anchor there', () => {
    (window as { Telegram?: unknown }).Telegram = { WebApp: {} };
    render(<ExternalLink href={HOSTS[0] as string}>Get a key</ExternalLink>);
    expect(screen.getByRole('link', { name: 'Get a key' })).toBeTruthy();
  });
});

describe('the key hint', () => {
  it('in the installed app, the hint line carries its own copy control inline', async () => {
    setStandalone(true);
    const { container } = render(<LinkifiedHint text={PROVIDER_PRESETS.gemini.keyHint} />);

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('Get a free key at');
    fireEvent.click(screen.getByRole('button', { name: /copy link to aistudio\.google\.com/i }));
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith('https://aistudio.google.com'),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Paste it into Safari');
  });

  it('on the onboarding key step it is right there, one tap from copied', async () => {
    setStandalone(true);
    const backend = { mode: 'worker', saveApiKey: vi.fn() } as unknown as Backend;
    render(<OnboardingScreen backend={backend} startAtKeyStep onDone={vi.fn()} onSkip={vi.fn()} />);

    // Visible without opening anything else, next to the key field.
    const copy = screen.getByRole('button', { name: /copy link to aistudio\.google\.com/i });
    expect(screen.getByLabelText('API key')).toBeTruthy();
    fireEvent.click(copy);

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Copied. Paste it into Safari.',
    );
    // The form is still usable: no overlay took it over.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('in a browser tab it is a plain anchor', () => {
    setStandalone(false);
    const { container } = render(<LinkifiedHint text={PROVIDER_PRESETS.gemini.keyHint} />);
    expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
