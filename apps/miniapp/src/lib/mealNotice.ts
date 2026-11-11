/**
 * The confirmation a finished capture ends with on Android, the counterpart of the iOS
 * Shortcut's notification: "Meal logged / 612 kcal — Grilled salmon, rice".
 *
 * It only ever uses permission that has ALREADY been granted (by turning on reminders).
 * It never asks: a permission prompt out of nowhere, right after saving a meal, is how
 * people learn to say no.
 */
export async function notifyLogged(title: string, body: string): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    if (!('serviceWorker' in navigator)) return false;
    // getRegistration, not `.ready`: that never settles when no worker is registered.
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    await registration.showNotification(title, {
      body,
      tag: 'meal-logged',
      icon: '/icon-192.png',
      data: { url: '/' },
    });
    return true;
  } catch {
    return false;
  }
}

/** `612 kcal — Grilled salmon, rice` */
export function mealNoticeBody(meal: {
  title?: string | null;
  foods: Array<{ food: { name: string } }>;
  total: { energyKcal: number };
}): string {
  const label =
    meal.title?.trim() ||
    meal.foods
      .slice(0, 2)
      .map((f) => f.food.name)
      .join(', ') ||
    'Meal';
  return `${Math.round(meal.total.energyKcal)} kcal — ${label}`;
}
