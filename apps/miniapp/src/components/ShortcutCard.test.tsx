import type { Backend } from '@/lib/backend';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTokenInfo } from '../lib/api.js';
import { ShortcutCard } from './ShortcutCard.js';

const RAW = 'sb_TEST-RAW-TOKEN-VALUE';

function stub(initial: DeviceTokenInfo[] = []) {
  let rows = [...initial];
  const backend = {
    listDeviceTokens: vi.fn(async () => rows),
    createDeviceToken: vi.fn(async () => {
      const row = {
        id: 't-new',
        label: 'iOS Shortcut',
        createdAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
      };
      rows = [row, ...rows];
      return { id: row.id, token: RAW, label: row.label, createdAt: row.createdAt };
    }),
    revokeDeviceToken: vi.fn(async (id: string) => {
      rows = rows.filter((r) => r.id !== id);
    }),
    revokeAllDeviceTokens: vi.fn(async () => {
      const n = rows.length;
      rows = [];
      return n;
    }),
  };
  return { backend: backend as unknown as Backend, spies: backend };
}

const OLD: DeviceTokenInfo = {
  id: 't-old',
  label: 'iOS Shortcut',
  createdAt: Date.UTC(2026, 0, 5),
  lastUsedAt: null,
  revokedAt: null,
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('ShortcutCard', () => {
  it('idle: offers to create a token and shows it once after creating', async () => {
    const { backend, spies } = stub();
    render(<ShortcutCard backend={backend} />);

    expect(screen.getByText('One-tap photo logging')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));

    expect(await screen.findByText(RAW)).toBeInTheDocument();
    expect(spies.createDeviceToken).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });

  it('removes the token from the DOM once dismissed', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW);
  });

  it('asks for confirmation before revoking, and only revokes on confirm', async () => {
    const { backend, spies } = stub([OLD]);
    render(<ShortcutCard backend={backend} />);

    await userEvent.click(await screen.findByRole('button', { name: /^Revoke iOS Shortcut/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke this token?')).toBeInTheDocument();
    expect(spies.revokeDeviceToken).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(spies.revokeDeviceToken).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^Revoke iOS Shortcut/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }),
    );
    await waitFor(() => expect(spies.revokeDeviceToken).toHaveBeenCalledWith('t-old'));
  });

  it('confirms before revoking everything', async () => {
    const { backend, spies } = stub([OLD]);
    render(<ShortcutCard backend={backend} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke all' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke all tokens?')).toBeInTheDocument();
    expect(spies.revokeAllDeviceTokens).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(spies.revokeAllDeviceTokens).toHaveBeenCalled());
  });

  it('falls back to "Press and hold to copy." when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);

    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(await screen.findByText('Press and hold to copy.')).toBeInTheDocument();
  });
});

describe('ShortcutCard: the three steps', () => {
  const HREF = '/shortcut/snapbite-log-meal.shortcut';

  it('shows all three steps, in order, before there is any token', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);

    const headings = [
      '1. Get the shortcut',
      '2. Put your token in it',
      '3. Point the Action Button at it',
    ].map((t) => screen.getByText(t));
    for (let i = 1; i < headings.length; i++) {
      expect(
        (headings[i - 1] as HTMLElement).compareDocumentPosition(headings[i] as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Visible by default: not folded away behind "How it works".
    expect(screen.queryByText('How it works')).toBeNull();
  });

  const FILE = 'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut';
  const asUserAgent = (ua: string) =>
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent');
  });

  it('on iOS, step 1 hands the file to Shortcuts through its URL scheme (no navigation to the file)', async () => {
    asUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    const link = screen.getByRole('link', { name: 'Add the Shortcut' });
    const href = link.getAttribute('href') as string;

    expect(href.startsWith('shortcuts://import-shortcut?url=')).toBe(true);
    const url = new URL(href.replace('shortcuts://', 'https://x/'));
    expect(url.searchParams.get('url')).toBe(FILE);
    expect(href).toContain(encodeURIComponent(FILE));
    expect(href.endsWith('&name=SnapBite%20Log%20Meal')).toBe(true);
    // A plain anchor: no new tab, no download, nothing fetched.
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.hasAttribute('download')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);
    expect(
      screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href'),
    ).not.toContain(RAW);
  });

  it('elsewhere, step 1 falls back to the plain https file link', () => {
    asUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36');
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(FILE);
  });

  it('always shows the same https link as copyable text under the button', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    ]) {
      asUserAgent(ua);
      const { backend } = stub();
      const view = render(<ShortcutCard backend={backend} />);
      expect(screen.getByTestId('shortcut-file-url').textContent).toBe(FILE);
      expect(screen.getByRole('button', { name: 'Copy shortcut link' })).toBeTruthy();
      view.unmount();
    }
  });

  it('says it opens the Shortcuts app and to come back, and that the token step happens there', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    expect(
      screen.getByText('It opens the Shortcuts app — tap Add Shortcut, then come back here.'),
    ).toBeTruthy();
    expect(container.textContent).toContain(
      'after the shortcut is added, inside the Shortcuts app — not in SnapBite',
    );
  });

  it('step 2 names the field and the text to replace exactly, and says the token is shown once', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    const text = container.textContent ?? '';
    expect(text).toContain('tap the Authorization field');
    expect(screen.getByText('PASTE_YOUR_TOKEN_HERE')).toBeTruthy();
    expect(text).toContain('replace PASTE_YOUR_TOKEN_HERE with your token');
    expect(text).toContain('sb_');
    expect(text).toMatch(/shown only once/i);
  });

  it('tells the person how to fill in Show Notification so it looks like the card', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Title to Meal logged');
    expect(text).toContain('Body to Contents of URL');
    expect(text).toContain('Attachment to Photo');
    expect(text).toContain('Title Meal logged, Body Contents of URL, Attachment Photo');
  });

  it('step 3 gives the Action Button path in order, and the card says why', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    expect(container.textContent).toContain(
      'Settings → Action Button → Shortcut → SnapBite Log Meal',
    );
    expect(
      screen.getByText(
        'Hold the Action Button, take a photo, and the notification says what was logged.',
      ),
    ).toBeTruthy();
  });

  it('folds into one "How it works" line only once the person has a token', async () => {
    const { backend } = stub([OLD]);
    render(<ShortcutCard backend={backend} />);

    const summary = await screen.findByText('How it works');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByText('1. Get the shortcut'))).toBe(true);

    // Making a new token brings the steps back into view.
    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);
    expect(screen.queryByText('How it works')).toBeNull();
  });

  it('keeps the by-hand route for a phone that cannot add the file', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(screen.getByText("Can't add it? Set it up by hand")).toBeTruthy();
    expect(screen.getByText(/Take Photo → Convert Image/)).toBeTruthy();
  });

  it('tells a browser visitor to add SnapBite to the Home Screen first, but not the installed app', () => {
    const { backend } = stub();
    const note = /Add SnapBite to your Home Screen first/;

    const browser = render(<ShortcutCard backend={backend} />);
    expect(screen.getByText(note)).toBeTruthy();
    browser.unmount();

    window.matchMedia = ((q: string) => ({
      matches: q.includes('standalone'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    render(<ShortcutCard backend={backend} />);
    expect(screen.queryByText(note)).toBeNull();
  });

  it('starts every step with a verb, in plain words', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    for (const word of ['Get', 'Put', 'Point']) {
      expect(container.textContent).toMatch(new RegExp(`\\d\\. ${word} `));
    }
    expect(container.textContent).not.toMatch(/configure|authenticate/i);
  });
});
