import { useLayoutEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore';

let blockingModalSequence = 0;

function createBlockingModalId(): string {
  blockingModalSequence += 1;
  return `blocking-modal-${blockingModalSequence}`;
}

export function useBlockingModal(open: boolean): void {
  const registerBlockingModal = useUiStore((state) => state.registerBlockingModal);
  const unregisterBlockingModal = useUiStore((state) => state.unregisterBlockingModal);
  const modalIdRef = useRef<string>('');

  if (!modalIdRef.current) {
    modalIdRef.current = createBlockingModalId();
  }

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const modalId = modalIdRef.current;
    registerBlockingModal(modalId);
    return () => {
      unregisterBlockingModal(modalId);
    };
  }, [open, registerBlockingModal, unregisterBlockingModal]);
}
