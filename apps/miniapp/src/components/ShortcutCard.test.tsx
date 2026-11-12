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

const EASY = 'Set up with Shortcut app';
const HAND = 'Set up manually';
const FILE = 'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut';
const accordion = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const openEasy = async () => {
  const btn = accordion(EASY);
  if (btn.getAttribute('aria-expanded') !== 'true') await userEvent.click(btn);
};
/** The text of the numbered steps inside one accordion's panel, in order. */
const stepsOf = (name: string) => {
  const panel = document.getElementById(accordion(name).getAttribute('aria-controls') as string);
  return [...(panel?.querySelectorAll(':scope > ol > li') ?? [])].map((li) =>
    (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
};
const asUserAgent = (ua: string) =>
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });

describe('ShortcutCard: the two accordions', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent');
  });

  it('marks the first row "iOS only" in a muted pill that stays on the title line', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);

    const btn = accordion(EASY);
    expect(btn).toHaveAccessibleName('Set up with Shortcut app iOS only');
    const badge = screen.getByLabelText('iOS only');
    expect(badge).toHaveTextContent('iOS only');
    // Muted caption on the secondary surface, not a coloured tag.
    expect(badge.className).toContain('bg-secondary');
    expect(badge.className).toContain('text-muted-foreground');
    expect(badge.className).toContain('text-caption');
    expect(badge.className).toContain('rounded-control');
    // Beside the title, never on its own line: the row is a flex line and the
    // badge holds its width, so it cannot wrap under the title at 375pt.
    expect(badge.className).toContain('shrink-0');
    expect(badge.className).toContain('whitespace-nowrap');
    const line = badge.parentElement as HTMLElement;
    expect(line.className).toContain('flex');
    expect(line.className).toContain('items-center');
    expect(line.className).not.toContain('flex-col');
    expect(btn).toContainElement(badge);
  });

  it('are both closed to begin with, content mounted but hidden', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    for (const name of [EASY, HAND]) {
      const btn = accordion(name);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      const panel = document.getElementById(btn.getAttribute('aria-controls') as string);
      expect(panel?.hasAttribute('hidden')).toBe(true);
      expect(panel?.querySelector('ol')).toBeTruthy(); // mounted, just collapsed
    }
  });

  it('opens the first one by itself on a phone that reports iOS, and leaves the second closed', () => {
    asUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15');
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(accordion(EASY).getAttribute('aria-expanded')).toBe('true');
    expect(accordion(HAND).getAttribute('aria-expanded')).toBe('false');
  });

  it('opening one closes the other, and a second tap closes it', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);

    await userEvent.click(accordion(EASY));
    expect(accordion(EASY).getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(accordion(HAND));
    expect(accordion(HAND).getAttribute('aria-expanded')).toBe('true');
    expect(accordion(EASY).getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(accordion(HAND));
    expect(accordion(HAND).getAttribute('aria-expanded')).toBe('false');
  });

  it('"Set up with Shortcut app" has its four numbered steps in order, and the closing line', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    expect(stepsOf(EASY)).toEqual([
      'Add the Shortcut.',
      'Tap Open in Shortcuts, then Add Shortcut.',
      'Open the shortcut, tap Authorization, replace PASTE_YOUR_TOKEN_HERE with your token from above, keeping the word Bearer and one space.',
      'Settings → Action Button → Shortcut → SnapBite Log Meal.',
    ]);
    const text = container.textContent ?? '';
    expect(text).toContain('SnapBite gives you a ready-made shortcut. You only add your token.');
    expect(text).toContain(
      'Hold the Action Button, take a photo, the notification tells you what was logged.',
    );
  });

  it('"Set up manually" has its four actions in order, each naming its fields', () => {
    const { backend } = stub();
    const { container } = render(<ShortcutCard backend={backend} />);
    const steps = stepsOf(HAND);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toBe('Take Photo — turn on Show Camera Preview.');
    expect(steps[1]).toBe('Convert Image → JPEG, quality 0.6.');
    expect(steps[2]).toContain('Get Contents of URL');
    expect(steps[2]).toContain('https://snapbite.leeguanfeng.com/api/shortcut/log');
    expect(steps[2]).toContain('Method POST, Request Body Form.');
    expect(steps[2]).toContain('New field photo, type File, value Converted Image.');
    expect(steps[2]).toContain('Header Authorization = Bearer, a space, then your token.');
    expect(steps[3]).toBe(
      'Show Notification → Title Meal logged, Body Contents of URL, Attachment Converted Image.',
    );
    expect(container.textContent).toContain(
      'Convert Image is not optional: iPhones shoot HEIC and the server only accepts JPEG.',
    );
  });

  it('keeps the token above both, where the steps say "from above"', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    const create = screen.getByRole('button', { name: 'Create Shortcut token' });
    expect(
      create.compareDocumentPosition(accordion(EASY)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('puts nothing a phone has to scroll sideways for: long strings wrap', () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(screen.getByTestId('shortcut-file-url').className).toContain('[overflow-wrap:anywhere]');
    const hand = document.getElementById(accordion(HAND).getAttribute('aria-controls') as string);
    expect(hand?.className).toContain('min-w-0');
    expect(hand?.innerHTML).toContain('[overflow-wrap:anywhere]');
  });

  it('step 1 is a plain link to the https file, never the shortcuts:// scheme', async () => {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await openEasy();
    const link = screen.getByRole('link', { name: 'Add the Shortcut' });
    expect(link.getAttribute('href')).toBe(FILE);
    expect(link.getAttribute('href')).not.toContain('shortcuts://');
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.hasAttribute('download')).toBe(false);
  });

  it('"Copy link" copies that same https string', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await openEasy();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(FILE);
    expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(
      writeText.mock.calls[0]?.[0],
    );
  });

  it('with an iCloud link set, the primary button leads with it and the file stays as the other way', async () => {
    const ICLOUD = 'https://www.icloud.com/shortcuts/0123456789abcdef';
    icloud.url = ICLOUD;
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await openEasy();

    expect(screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href')).toBe(
      ICLOUD,
    );
    expect(stepsOf(EASY)[1]).toBe('Tap Get Shortcut, then Add Shortcut.');
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
  const start = async (rows?: DeviceTokenInfo[]) => {
    const { backend, spies } = stub(rows);
    render(<ShortcutCard backend={backend} />);
    await openEasy();
    return { backend, spies };
  };

  it('opens a dialog instead of navigating, with the three lines in order and nothing more', async () => {
    await start();
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
    await start();
    await userEvent.click(add());
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(nav.to).toHaveBeenCalledTimes(1);
    expect(nav.to).toHaveBeenCalledWith(PATH);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel closes it without navigating, and is before Continue in the DOM, and focused', async () => {
    await start();
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
    await start();
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
    await start([USED]);
    await screen.findByRole('link', { name: 'Add the Shortcut' });
    // Wait for the token list to load, so the card knows this token was used.
    await screen.findByText(/used /);

    expect(await clickAndSeeIfPrevented()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add().getAttribute('href')).toBe(
      'https://snapbite.leeguanfeng.com/shortcut/snapbite-log-meal.shortcut',
    );
  });

  it('holds the link back, to show the dialog, until a token has been used', async () => {
    await start();
    expect(await clickAndSeeIfPrevented()).toBe(true);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('still shows it for a token that exists but has never been used', async () => {
    await start([OLD]); // lastUsedAt: null
    await screen.findByText(/never used/);
    await userEvent.click(add());
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
