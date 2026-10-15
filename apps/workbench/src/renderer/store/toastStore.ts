import { create } from 'zustand';

type ToastAnchor = { x: number; y: number };

type ToastItem = {
  id: string;
  message: string;
  anchor: ToastAnchor | null;
};

type PushToastOptions = {
  durationMs?: number;
  /** Pixel coordinates (window-relative) to render the toast next to. */
  anchor?: ToastAnchor | null;
};

type ToastState = {
  toasts: ToastItem[];
  /** Last observed pointer position; used as default anchor for keyboard-triggered toasts. */
  lastPointer: ToastAnchor | null;
  pushToast: (message: string, optionsOrDuration?: number | PushToastOptions) => void;
  setLastPointer: (anchor: ToastAnchor | null) => void;
  dismissToast: (id: string) => void;
};

function createToastId() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  lastPointer: null,
  pushToast: (message, optionsOrDuration) => {
    const text = message.trim();
    if (!text) {
      return;
    }
    const options: PushToastOptions = typeof optionsOrDuration === 'number'
      ? { durationMs: optionsOrDuration }
      : (optionsOrDuration ?? {});
    const durationMs = options.durationMs ?? 2600;
    // Explicit anchor wins; otherwise reuse last pointer position so the toast
    // appears near where the user is interacting (mouse or keyboard).
    const anchor = options.anchor === null
      ? null
      : options.anchor ?? get().lastPointer;

    const id = createToastId();
    set((state) => ({
      toasts: [...state.toasts, { id, message: text, anchor }],
    }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, durationMs);
  },
  setLastPointer: (anchor) => set({ lastPointer: anchor }),
  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
}));
