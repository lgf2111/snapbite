import { afterEach, describe, expect, it, vi } from 'vitest';
import { mealNoticeBody, notifyLogged } from './mealNotice.js';

const showNotification = vi.fn(async () => {});
const requestPermission = vi.fn(async () => 'granted');

function setup(permission: NotificationPermission, registered = true) {
  vi.stubGlobal('Notification', { permission, requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: vi.fn(async () => (registered ? { showNotification } : undefined)) },
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  showNotification.mockClear();
  requestPermission.mockClear();
});

describe('notifyLogged', () => {
  it('posts the notification when permission has already been granted', async () => {
    setup('granted');
    expect(await notifyLogged('Meal logged', '612 kcal — Grilled salmon, rice')).toBe(true);
    expect(showNotification).toHaveBeenCalledWith(
      'Meal logged',
      expect.objectContaining({ body: '612 kcal — Grilled salmon, rice', tag: 'meal-logged' }),
    );
  });

  it.each(['default', 'denied'] as const)(
    'posts nothing when permission is %s, and never asks',
    async (p) => {
      setup(p);
      expect(await notifyLogged('Meal logged', 'x')).toBe(false);
      expect(showNotification).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
    },
  );

  it('posts nothing, and does not hang, when no worker is registered', async () => {
    setup('granted', false);
    expect(await notifyLogged('Meal logged', 'x')).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('is quiet where notifications do not exist at all', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await notifyLogged('Meal logged', 'x')).toBe(false);
  });
});

describe('mealNoticeBody', () => {
  const food = (name: string) => ({ food: { name } });
  it('is kcal, a dash, and the meal name', () => {
    expect(
      mealNoticeBody({ title: ' Grilled salmon, rice ', foods: [], total: { energyKcal: 611.6 } }),
    ).toBe('612 kcal — Grilled salmon, rice');
    expect(
      mealNoticeBody({
        foods: [food('rice'), food('egg'), food('tea')],
        total: { energyKcal: 300 },
      }),
    ).toBe('300 kcal — rice, egg');
  });
});
