import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../components/ui/sonner.js';
import {
  type AppUpdateOptions,
  CHECK_INTERVAL_MS,
  DISMISSED_BUILD_KEY,
  UPDATE_MESSAGE,
  useAppUpdate,
} from './appUpdate.js';

type HarnessProps = Pick<AppUpdateOptions, 'buildId' | 'isBlocked' | 'now' | 'reload'>;

function Harness({ buildId, isBlocked, now, reload }: HarnessProps) {
  const { check, checkAfterActivity } = useAppUpdate({ buildId, isBlocked, now, reload });
  return (
    <>
      <button type="button" onClick={check}>
        check now
      </button>
      <button type="button" onClick={checkAfterActivity}>
        check after activity
      </button>
    </>
  );
}

function renderApp(props: HarnessProps = {}) {
  return render(
    <>
      <Toaster />
      <Harness {...props} />
    </>,
  );
}

/** Answer `/version.json` with `body`; returns the fetch mock. */
function serve(body: unknown, init?: ResponseInit) {
  const mock = vi.fn(async () => Response.json(body, init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Let the mounted check's promise chain finish. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

beforeEach(() => {
  cleanup();
  toast.dismiss();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  toast.dismiss();
  sessionStorage.clear();
  document.getElementById('test-blocker')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setVisibility('visible');
});

describe('app update notice', () => {
  it('shows exactly one notice with a working reload action when the ids differ', async () => {
    const fetchMock = serve({ id: 'deployed-build', builtAt: 1 });
    const reload = vi.fn();
    renderApp({ buildId: 'running-build', reload });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(UPDATE_MESSAGE)).toBeTruthy();
    expect(screen.getAllByText(UPDATE_MESSAGE)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the deployed and running ids match', async () => {
    const fetchMock = serve({ id: 'same-build' });
    renderApp({ buildId: 'same-build' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
  });

  it('stays quiet for an id dismissed in this session, but not for a newer one', async () => {
    const fetchMock = serve({ id: 'dismissed-build' });
    renderApp({ buildId: 'running-build' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText(UPDATE_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: 'Close toast' }));
    await waitFor(() => expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull());
    expect(sessionStorage.getItem(DISMISSED_BUILD_KEY)).toBe('dismissed-build');

    // The same id comes back on the next check: silence.
    fireEvent.click(screen.getByRole('button', { name: 'check now' }));
    await settle();
    expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();

    // A different deploy is a different id: the notice is allowed again.
    fetchMock.mockImplementation(async () => Response.json({ id: 'newer-build' }));
    fireEvent.click(screen.getByRole('button', { name: 'check now' }));
    expect(await screen.findByText(UPDATE_MESSAGE)).toBeTruthy();
  });

  it('checks right away when the app comes back to the screen', async () => {
    const fetchMock = serve({ id: 'same-build' });
    renderApp({ buildId: 'same-build' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('checks at most once a minute after a meal save or screen change', async () => {
    let clock = 1_000_000;
    const fetchMock = serve({ id: 'same-build' });
    renderApp({ buildId: 'same-build', now: () => clock });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'check after activity' }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += CHECK_INTERVAL_MS + 1;
    fireEvent.click(screen.getByRole('button', { name: 'check after activity' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('never fetches while the page is hidden', async () => {
    setVisibility('hidden');
    const fetchMock = serve({ id: 'deployed-build' });
    renderApp({ buildId: 'running-build' });

    // The after-first-paint check runs, but a hidden page has nowhere to show
    // an answer, so it does not ask.
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'check now' }));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
  });

  it('says nothing and logs nothing when version.json is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    renderApp({ buildId: 'running-build' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();

    expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('holds the notice while a surface owns the screen, then shows it when clear', async () => {
    const blocker = document.createElement('div');
    blocker.id = 'test-blocker';
    blocker.setAttribute('role', 'dialog');
    blocker.setAttribute('aria-modal', 'true');
    document.body.append(blocker);

    const fetchMock = serve({ id: 'deployed-build' });
    renderApp({ buildId: 'running-build' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();

    blocker.remove();
    expect(await screen.findByText(UPDATE_MESSAGE)).toBeTruthy();
    blocker.remove();
  });
});
