/** The toast shape shared by screens: a kind, a sentence, and an optional action. */
export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export type ToastFn = (kind: ToastKind, message: string, action?: ToastAction) => void;
