import { describe, expect, it } from 'vitest';
import { initialToastState, MAX_TOASTS, toastReducer } from './toast.js';

describe('toastReducer', () => {
  it('adds a toast with an incrementing id', () => {
    const s1 = toastReducer(initialToastState, { type: 'add', kind: 'success', message: 'Saved' });
    expect(s1.toasts).toHaveLength(1);
    expect(s1.toasts[0]).toMatchObject({ id: 1, kind: 'success', message: 'Saved' });

    const s2 = toastReducer(s1, { type: 'add', kind: 'error', message: 'Oops' });
    expect(s2.toasts).toHaveLength(2);
    expect(s2.toasts[1]?.id).toBe(2);
  });

  it('dismisses a toast by id', () => {
    let s = toastReducer(initialToastState, { type: 'add', kind: 'info', message: 'A' });
    s = toastReducer(s, { type: 'add', kind: 'info', message: 'B' });
    const firstId = s.toasts[0]?.id as number;
    s = toastReducer(s, { type: 'dismiss', id: firstId });
    expect(s.toasts.map((t) => t.message)).toEqual(['B']);
  });

  it('caps the queue at MAX_TOASTS, dropping the oldest', () => {
    let s = initialToastState;
    for (let i = 0; i < MAX_TOASTS + 2; i++) {
      s = toastReducer(s, { type: 'add', kind: 'info', message: `m${i}` });
    }
    expect(s.toasts).toHaveLength(MAX_TOASTS);
    // Oldest ('m0','m1') fell off.
    expect(s.toasts[0]?.message).toBe('m2');
  });

  it('clears all toasts but preserves the id counter', () => {
    let s = toastReducer(initialToastState, { type: 'add', kind: 'info', message: 'A' });
    s = toastReducer(s, { type: 'clear' });
    expect(s.toasts).toHaveLength(0);
    const s2 = toastReducer(s, { type: 'add', kind: 'info', message: 'B' });
    expect(s2.toasts[0]?.id).toBe(2);
  });
});
