import { useCallback, useEffect, useReducer, useRef } from 'react';
import { hapticNotify } from '../lib/telegram.js';
import { initialToastState, type ToastKind, toastReducer } from '../lib/toast.js';

const AUTO_DISMISS_MS = 3000;

/**
 * Toast state + a `notify` helper. Auto-dismisses each toast after a few
 * seconds and fires a matching haptic. Returns the render host separately.
 */
export function useToasts() {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Track the highest id we've scheduled so new toasts get a dismiss timer.
  const scheduled = useRef(0);

  const notify = useCallback((kind: ToastKind, message: string) => {
    dispatch({ type: 'add', kind, message });
    if (kind === 'success') hapticNotify('success');
    else if (kind === 'error') hapticNotify('error');
  }, []);

  const dismiss = useCallback((id: number) => dispatch({ type: 'dismiss', id }), []);

  // Schedule auto-dismiss for any newly added toast.
  useEffect(() => {
    for (const t of state.toasts) {
      if (t.id > scheduled.current && !timers.current.has(t.id)) {
        const handle = setTimeout(() => dispatch({ type: 'dismiss', id: t.id }), AUTO_DISMISS_MS);
        timers.current.set(t.id, handle);
      }
    }
    if (state.toasts.length > 0) {
      scheduled.current = Math.max(scheduled.current, ...state.toasts.map((t) => t.id));
    }
    // Clean up timers for toasts that are gone.
    for (const [id, handle] of timers.current) {
      if (!state.toasts.some((t) => t.id === id)) {
        clearTimeout(handle);
        timers.current.delete(id);
      }
    }
  }, [state.toasts]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  return { toasts: state.toasts, notify, dismiss };
}

interface ToastHostProps {
  toasts: ReturnType<typeof useToasts>['toasts'];
  onDismiss: (id: number) => void;
}

/** Renders the active toasts as a stack at the bottom of the screen. */
export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
