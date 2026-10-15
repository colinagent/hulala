import { useEffect, useRef, type RefObject } from 'react';

export type UseDismissOnOutsideInteractionOptions = {
  active: boolean;
  onDismiss: () => void;
  insideRefs: RefObject<Element | null>[];
  dismissOnBlur?: boolean;
  dismissOnEscape?: boolean;
};

function isInsideRefs(target: EventTarget | null, refs: RefObject<Element | null>[]): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  return refs.some((ref) => ref.current?.contains(target) ?? false);
}

export function useDismissOnOutsideInteraction({
  active,
  onDismiss,
  insideRefs,
  dismissOnBlur = true,
  dismissOnEscape = true,
}: UseDismissOnOutsideInteractionOptions): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const insideRefsRef = useRef(insideRefs);
  insideRefsRef.current = insideRefs;

  useEffect(() => {
    if (!active) {
      return;
    }

    const handlePointerDown = (event: Event) => {
      if (isInsideRefs(event.target, insideRefsRef.current)) {
        return;
      }
      onDismissRef.current();
    };

    const handleBlur = () => {
      if (window.hulala?.kind === 'browser' && !document.hidden) return;
      onDismissRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      onDismissRef.current();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    if (dismissOnBlur) {
      window.addEventListener('blur', handleBlur);
      document.addEventListener('visibilitychange', handleBlur);
    }
    if (dismissOnEscape) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
      if (dismissOnBlur) {
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('visibilitychange', handleBlur);
      }
      if (dismissOnEscape) {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [active, dismissOnBlur, dismissOnEscape]);
}
