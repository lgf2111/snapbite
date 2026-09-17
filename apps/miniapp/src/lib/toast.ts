/**
 * A tiny toast state model. The reducer is pure so the queue behavior (add,
 * auto-dismiss, cap) can be unit-tested without React or timers.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastState {
  toasts: Toast[];
  /** Monotonic counter used to generate stable ids. */
  nextId: number;
}

export type ToastAction =
  | { type: 'add'; kind: ToastKind; message: string }
  | { type: 'dismiss'; id: number }
  | { type: 'clear' };

/** Never show more than this many toasts at once; oldest fall off. */
export const MAX_TOASTS = 3;

export const initialToastState: ToastState = { toasts: [], nextId: 1 };

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'add': {
      const toast: Toast = { id: state.nextId, kind: action.kind, message: action.message };
      const toasts = [...state.toasts, toast].slice(-MAX_TOASTS);
      return { toasts, nextId: state.nextId + 1 };
    }
    case 'dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'clear':
      return { ...state, toasts: [] };
    default:
      return state;
  }
}
