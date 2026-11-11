import type { Backend } from '@/lib/backend';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTokenInfo } from '../lib/api.js';
import { ShortcutCard } from './ShortcutCard.js';

// The iCloud link is a module constant, empty until published; let each test choose it.
const icloud = vi.hoisted(() => ({ url: '' }));
vi.mock('../lib/shortcut.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/shortcut.js')>()),
  get SHORTCUT_ICLOUD_URL() {
    return icloud.url;
  },
}));

const nav = vi.hoisted(() => ({ to: vi.fn() }));
vi.mock('../lib/navigate.js', () => ({ navigateTo: nav.to }));

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
  icloud.url = '';
  nav.to.mockClear();
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

  it('step 1 is a plain link to the https file, never the shortcuts:// scheme', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    const link = screen.getByRole('link', { name: 'Add the Shortcut' });
    expect(link.getAttribute('href')).toBe(FILE);
    expect(link.getAttribute('href')).not.toContain('shortcuts://');
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.hasAttribute('download')).toBe(false);
    expect(
      screen.getByText('It opens a file preview — tap Open in Shortcuts, then Add Shortcut.'),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);
    expect(
      screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href'),
    ).not.toContain(RAW);
  });

  it('the same link is the same on every device, and shown as text', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',
      'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    ]) {
      asUserAgent(ua);
      const { backend } = stub();
      const view = render(<ShortcutCard backend={backend} />);
      expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(
        FILE,
      );
      expect(screen.getByTestId('shortcut-file-url').textContent).toBe(FILE);
      view.unmount();
    }
  });

  it('"Copy link" copies that same https string', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(FILE);
    expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(
      writeText.mock.calls[0]?.[0],
    );
  });

  it('with an iCloud link set, the primary button leads with it and the file stays as the other way', async () => {
    const ICLOUD = 'https://www.icloud.com/shortcuts/0123456789abcdef';
    icloud.url = ICLOUD;
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);

    expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(
      ICLOUD,
    );
    expect(screen.getByText(/tap Get Shortcut, then Add Shortcut/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Use the file link instead' }).getAttribute('href'),
    ).toBe(FILE);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(ICLOUD);
  });

  it('without one, there is no iCloud line to point at nothing', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(screen.queryByText(/iCloud/i)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Use the file link instead' })).toBeNull();
  });

  it('says the token step happens after the shortcut is added, in the Shortcuts app', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
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

describe('ShortcutCard: revoke confirmation', () => {
  const LONG: DeviceTokenInfo = {
    ...OLD,
    id: 't-long',
    label: 'iPhone 15 Pro Max Shortcut for the kitchen counter and the gym bag and the car',
  };

  async function openOne(rows: DeviceTokenInfo[] = [OLD]) {
    const { backend, spies } = stub(rows);
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /^Revoke / }))[0] as HTMLElement,
    );
    return { dialog: await screen.findByRole('dialog'), spies };
  }

  it('is built on the dialog primitive: a dimming, blurred scrim covers the screen behind it', async () => {
    await openOne();
    const scrim = document.querySelector('[data-slot=dialog-overlay]') as HTMLElement;
    expect(scrim).toBeTruthy();
    expect(scrim.className).toContain('fixed');
    expect(scrim.className).toContain('inset-0');
    expect(scrim.className).toContain('bg-background/80');
    expect(scrim.className).toContain('backdrop-blur');
    // Above the tab bar (z-40), so nothing behind the panel stays readable.
    expect(scrim.className).toContain('z-50');
  });

  it('names the token it applies to, with a one-line title and one sentence of consequence', async () => {
    const { dialog } = await openOne();
    expect(within(dialog).getByText('Revoke this token?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Any Shortcut using it stops working until you make a new one.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId('revoke-target').textContent).toContain('iOS Shortcut');
  });

  it('cannot clip a very long token label: the panel is inset, padded and scrolls, the label wraps', async () => {
    const { dialog } = await openOne([LONG]);
    const target = within(dialog).getByTestId('revoke-target');
    expect(target.textContent).toContain('for the kitchen counter and the gym bag');
    expect(target.className).toContain('break-words');
    expect(target.className).toContain('min-w-0');
    expect(target.className).not.toContain('truncate');

    expect(dialog.className).toContain('w-[calc(100%-2rem)]');
    expect(dialog.className).toContain('p-6');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[calc(100svh-');
  });

  it('puts Cancel before Revoke in the DOM, both full width and 44px tall, Revoke destructive', async () => {
    const { dialog } = await openOne();
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const revoke = within(dialog).getByRole('button', { name: 'Revoke' });
    expect(cancel.compareDocumentPosition(revoke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const b of [cancel, revoke]) {
      expect(b.className).toContain('w-full');
      expect(b.className).toContain('h-11');
    }
    expect(revoke.className).toContain('bg-destructive');
    expect(revoke.className).toContain('text-destructive-foreground');
    expect(cancel.className).toContain('bg-secondary');
    // Rendered top to bottom as the DOM reads: Cancel above the destructive action.
    const footer = dialog.querySelector('[data-slot=dialog-footer]') as HTMLElement;
    expect(footer.className).toContain('flex-col');
    expect(footer.className).not.toContain('flex-col-reverse');
  });

  it('opens with focus on Cancel, and a backdrop tap or Escape cancels without revoking', async () => {
    const { dialog, spies } = await openOne();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })),
    );

    await userEvent.click(document.querySelector('[data-slot=dialog-overlay]') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(spies.revokeDeviceToken).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: /^Revoke / })[0] as HTMLElement);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(spies.revokeDeviceToken).not.toHaveBeenCalled();
  });
});

describe('ShortcutCard: telling tokens apart', () => {
  it('labels a new token with the device and a short suffix', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    try {
      const { backend, spies } = stub();
      render(<ShortcutCard backend={backend} />);
      await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
      await screen.findByText(RAW);
      expect(spies.createDeviceToken).toHaveBeenCalledWith(
        expect.stringMatching(/^iPhone Shortcut · [0-9a-f]{4}$/),
      );
    } finally {
      Reflect.deleteProperty(navigator, 'userAgent');
    }
  });

  it('two old tokens with the same label and date read differently', async () => {
    const A = { ...OLD, id: 'aaaa-1' };
    const B = { ...OLD, id: 'bbbb-2' };
    const { backend } = stub([A, B]);
    render(<ShortcutCard backend={backend} />);
    const names = (await screen.findAllByRole('button', { name: /^Revoke (?!all)/ })).map(
      (b) => b.getAttribute('aria-label') as string,
    );
    expect(new Set(names).size).toBe(2);
  });
});

describe('ShortcutCard: the pre-flight dialog', () => {
  const PATH = '/shortcut/snapbite-log-meal.shortcut';
  const USED: DeviceTokenInfo = { ...OLD, id: 't-used', lastUsedAt: Date.UTC(2026, 1, 1) };
  const add = () => screen.getByRole('link', { name: 'Add the Shortcut' });

  it('opens a dialog instead of navigating, with the three lines in order and nothing more', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(add());

    const dialog = await screen.findByRole('dialog');
    expect(nav.to).not.toHaveBeenCalled();
    const lines = [...dialog.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual([
      'You will leave SnapBite for a moment.',
      'Tap Open in Shortcuts, then Add Shortcut.',
      'Come back here and paste your token into the Authorization field.',
    ]);
  });

  it('Continue navigates to the file in the same tap, and closes the dialog', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(add());
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(nav.to).toHaveBeenCalledTimes(1);
    expect(nav.to).toHaveBeenCalledWith(PATH);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel closes it without navigating, and is before Continue in the DOM, and focused', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(add());
    const dialog = await screen.findByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const cont = within(dialog).getByRole('button', { name: 'Continue' });
    expect(cancel.compareDocumentPosition(cont) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    await userEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(nav.to).not.toHaveBeenCalled();
  });

  it('is built on the dialog primitive: scrim, 16px insets, 24px padding', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(add());
    const dialog = await screen.findByRole('dialog');
    expect(document.querySelector('[data-slot=dialog-overlay]')).toBeTruthy();
    expect(dialog.className).toContain('w-[calc(100%-2rem)]');
    expect(dialog.className).toContain('p-6');
  });

  /** Whether the click on "Add the Shortcut" was cancelled by the time it reached the document. */
  async function clickAndSeeIfPrevented() {
    const seen: boolean[] = [];
    const onClick = (e: Event) => {
      // Stop jsdom from trying to follow the link; what we want is what the card did.
      seen.push(e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener('click', onClick);
    await userEvent.click(add());
    document.removeEventListener('click', onClick);
    return seen[0];
  }

  it('is skipped once a token has been used: the link just goes, with no dialog', async () => {
    const { backend } = stub([USED]);
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(await screen.findByText('How it works'));

    expect(await clickAndSeeIfPrevented()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add().getAttribute('href')).toBe(
      'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut',
    );
  });

  it('holds the link back, to show the dialog, until a token has been used', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(await clickAndSeeIfPrevented()).toBe(true);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('still shows it for a token that exists but has never been used', async () => {
    const { backend } = stub([OLD]); // lastUsedAt: null
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(await screen.findByText('How it works'));
    await userEvent.click(add());
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
