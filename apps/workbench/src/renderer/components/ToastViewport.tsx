import React, { useEffect } from 'react';
import { useToastStore } from '../store/toastStore';

const TOAST_ESTIMATED_WIDTH = 280;
const TOAST_ESTIMATED_HEIGHT = 36;
const ANCHOR_OFFSET_X = 14;
const ANCHOR_OFFSET_Y = 18;
const SCREEN_PADDING = 8;
const STACK_GAP = 8;

function clampAnchorRect(x: number, y: number, indexOffset: number) {
  const maxLeft = Math.max(SCREEN_PADDING, window.innerWidth - TOAST_ESTIMATED_WIDTH - SCREEN_PADDING);
  const maxTop = Math.max(SCREEN_PADDING, window.innerHeight - TOAST_ESTIMATED_HEIGHT - SCREEN_PADDING);
  const left = Math.min(Math.max(SCREEN_PADDING, x + ANCHOR_OFFSET_X), maxLeft);
  const top = Math.min(Math.max(SCREEN_PADDING, y + ANCHOR_OFFSET_Y + indexOffset), maxTop);
  return { left, top };
}

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);
  const setLastPointer = useToastStore((state) => state.setLastPointer);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      setLastPointer({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [setLastPointer]);

  if (toasts.length === 0) {
    return null;
  }

  // Toasts without an anchor fall back to a top-left stack.
  // Anchored toasts are rendered individually near the pointer so the user
  // notices feedback right where they are interacting.
  const anchoredToasts = toasts.filter((toast) => toast.anchor);
  const fallbackToasts = toasts.filter((toast) => !toast.anchor);

  return (
    <>
      {fallbackToasts.length > 0 ? (
        <div className="pointer-events-none fixed left-4 top-10 z-[80] flex max-w-md flex-col gap-2">
          {fallbackToasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              className="pointer-events-auto rounded-md border border-border bg-editor-bg px-3 py-2 text-left text-sm text-primary-text shadow-lg"
              onClick={() => dismissToast(toast.id)}
            >
              {toast.message}
            </button>
          ))}
        </div>
      ) : null}

      {anchoredToasts.map((toast, index) => {
        const { left, top } = clampAnchorRect(
          toast.anchor!.x,
          toast.anchor!.y,
          index * (TOAST_ESTIMATED_HEIGHT + STACK_GAP),
        );
        return (
          <button
            key={toast.id}
            type="button"
            style={{ position: 'fixed', left, top, zIndex: 80, maxWidth: TOAST_ESTIMATED_WIDTH }}
            className="pointer-events-auto rounded-md border border-border bg-editor-bg px-3 py-2 text-left text-sm text-primary-text shadow-lg"
            onClick={() => dismissToast(toast.id)}
          >
            {toast.message}
          </button>
        );
      })}
    </>
  );
}
