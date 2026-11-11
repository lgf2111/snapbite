import { readConfig } from './config.js';
import { installPlatform, isStandalone } from './install.js';

/**
 * Web push reminders from the client's side.
 *
 * What a person can actually do depends on where the app is running, and "can't,
 * yet" is a normal state rather than an error:
 *
 *  - `needs-install`  iOS Safari in a tab. iOS only delivers push to an app on
 *                     the Home Screen (16.4+), and does not even expose the API
 *                     in a tab. The fix is to add the app, not a settings change.
 *  - `unsupported`    a browser with no service worker / Push API at all.
 *  - `default`        can ask; the person has not been asked yet.
 *  - `denied`         asked and refused. Only the phone's Settings can undo it.
 *  - `granted`        allowed, but this device has no subscription yet.
 *  - `subscribed`     this device is subscribed and will be reminded.
 */
export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'default'
  | 'denied'
  | 'granted'
  | 'subscribed';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  // Checked first: in an iOS tab the Push API is simply absent, which would
  // otherwise read as "unsupported" and send the person nowhere.
  if (installPlatform() === 'ios' && !isStandalone()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';

  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') {
    return (await currentSubscription()) ? 'subscribed' : 'granted';
  }
  return 'default';
}

function api(path: string): string {
  return `${readConfig().apiBase}/api/push${path}`;
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(api(path), { credentials: 'include', ...init });
}

function applicationServerKey(key: string): Uint8Array {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Ask permission, subscribe this device and tell the server.
 *
 * Call it straight from a tap. iOS only shows the permission prompt for a call
 * made inside a user gesture, so the request comes first, before anything is
 * awaited that could lose the gesture.
 */
export async function enablePush(): Promise<PushState> {
  // Plain synchronous checks only: nothing is awaited before the permission
  // request, so the tap that got us here is still "the gesture" when it runs.
  if (installPlatform() === 'ios' && !isStandalone()) {
    throw new Error('Add SnapBite to your Home Screen first.');
  }
  if (!pushSupported()) throw new Error('This browser cannot receive notifications.');

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const keyRes = await call('/key');
  if (!keyRes.ok) throw new Error('Notifications are not set up on the server yet.');
  const { key } = (await keyRes.json()) as { key: string };

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(key) as BufferSource,
    }));

  const saved = await call('/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saved.ok) throw new Error('Could not save this device for reminders.');
  return 'subscribed';
}

/** Stop reminders on this device: forget it on the server, then unsubscribe the browser. */
export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await call('/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  return pushState();
}

/** Ask the server to push one notification to this account's devices now. */
export async function sendTestPush(): Promise<{ delivered: number }> {
  const res = await call('/test', { method: 'POST' });
  if (res.status === 409) throw new Error('This phone is not subscribed yet.');
  if (!res.ok) throw new Error('Could not send the test notification.');
  const body = (await res.json()) as { delivered?: number };
  return { delivered: body.delivered ?? 0 };
}
