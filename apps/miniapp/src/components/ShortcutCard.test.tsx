import type { Backend } from '@/lib/backend';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTokenInfo } from '../lib/api.js';
import { ShortcutCard } from './ShortcutCard.js';

// The template link is a module constant; let each test choose it.
const template = vi.hoisted(() => ({ url: '' }));
vi.mock('../lib/shortcut.js', () => ({
  get SHORTCUT_TEMPLATE_URL() {
    return template.url;
  },
}));

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
  template.url = '';
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

describe('ShortcutCard template link', () => {
  const TEMPLATE = 'https://www.icloud.com/shortcuts/0123456789abcdef';

  async function createToken() {
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create Shortcut token' }));
    await screen.findByText(RAW);
  }

  it('with no template link there is no "Add the Shortcut" control, only the manual steps', async () => {
    template.url = '';
    await createToken();

    expect(screen.queryByRole('link', { name: 'Add the Shortcut' })).toBeNull();
    expect(screen.queryByText(/paste your token once/i)).toBeNull();
    expect(screen.getByText(/Take Photo → Convert Image/)).toBeTruthy();
    expect(screen.getByText('Set it up in Shortcuts:')).toBeTruthy();
  });

  it('with a template link: a new-tab link above the manual steps, which stay as the fallback', async () => {
    template.url = TEMPLATE;
    await createToken();

    const link = screen.getByRole('link', { name: 'Add the Shortcut' });
    expect(link.getAttribute('href')).toBe(TEMPLATE);
    // Opens Shortcuts rather than navigating the installed app away.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText("You'll paste your token once when you add it.")).toBeTruthy();

    // The four actions are still there, underneath, now read as the fallback.
    expect(screen.getByText('Or set it up by hand:')).toBeTruthy();
    const firstStep = screen.getByText(/Take Photo → Convert Image/);
    expect(firstStep).toBeTruthy();
    expect(link.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });

  it('never puts the token in the link', async () => {
    template.url = TEMPLATE;
    await createToken();
    expect(
      screen.getByRole('link', { name: 'Add the Shortcut' }).getAttribute('href'),
    ).not.toContain(RAW);
  });

  it('shows no link before a token exists to paste', () => {
    template.url = TEMPLATE;
    const { backend } = stub();
    render(<ShortcutCard backend={backend} />);
    expect(screen.queryByRole('link', { name: 'Add the Shortcut' })).toBeNull();
  });
});
