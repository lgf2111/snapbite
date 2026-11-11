import type { Backend } from '@/lib/backend';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from './CaptureSheet.js';

function setup() {
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => []),
  } as unknown as Backend;
  const onOpenChange = vi.fn();
  render(
    <CaptureSheet
      backend={backend}
      open
      onOpenChange={onOpenChange}
      onLogged={vi.fn()}
      onManualLogged={vi.fn()}
      onToast={vi.fn()}
    />,
  );
  return { backend, onOpenChange };
}

afterEach(cleanup);

describe('CaptureSheet', () => {
  it('offers photo, library and by-hand entry', () => {
    setup();
    expect(screen.getByRole('button', { name: /take a photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose from library/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter it by hand/i })).toBeInTheDocument();
  });

  it('opens the manual meal form and closes the sheet when entering by hand', async () => {
    const { backend, onOpenChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: /enter it by hand/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // ManualMealDialog loads saved meals when it opens.
    await waitFor(() => expect(backend.listFavorites).toHaveBeenCalled());
  });
});
