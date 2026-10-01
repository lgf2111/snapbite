import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each test re-imports the module fresh so the module-load migration runs
// against the localStorage state we set up first.
afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('store legacy-key migration (foodlog.* -> snapbite.*)', () => {
  it('copies legacy meals/profile to the new keys and removes the old ones', async () => {
    const meals = JSON.stringify([{ id: 'a', savedAt: '2026-01-01', meal: { x: 1 } }]);
    const profile = JSON.stringify({ sex: 'male' });
    localStorage.setItem('foodlog.meals.v1', meals);
    localStorage.setItem('foodlog.profile.v1', profile);

    // Importing the module triggers migrateLegacyKeys() at load.
    await import('./store.js');

    expect(localStorage.getItem('snapbite.meals.v1')).toBe(meals);
    expect(localStorage.getItem('snapbite.profile.v1')).toBe(profile);
    expect(localStorage.getItem('foodlog.meals.v1')).toBeNull();
    expect(localStorage.getItem('foodlog.profile.v1')).toBeNull();
  });

  it('does not overwrite an existing new-key value, but still clears the legacy key', async () => {
    localStorage.setItem('foodlog.meals.v1', '["legacy"]');
    localStorage.setItem('snapbite.meals.v1', '["current"]');

    await import('./store.js');

    expect(localStorage.getItem('snapbite.meals.v1')).toBe('["current"]');
    expect(localStorage.getItem('foodlog.meals.v1')).toBeNull();
  });

  it('is a no-op when there are no legacy keys', async () => {
    const store = await import('./store.js');
    expect(store.loadMeals()).toEqual([]);
    expect(localStorage.getItem('snapbite.meals.v1')).toBeNull();
  });
});
