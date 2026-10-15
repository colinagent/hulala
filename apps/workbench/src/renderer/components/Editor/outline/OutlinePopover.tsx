import React, { useEffect, useRef } from 'react';
import { OP_POPUP_MENU, OP_SG_ON_EDITOR } from '../../staticGlassCapsule';

type OutlinePopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
};

/**
 * Apple Books-style document outline: a non-modal Static Glass card that
 * floats over the right side of the current editor without changing layout.
 */
export const OutlinePopover: React.FC<OutlinePopoverProps> = ({
  open,
  onOpenChange,
  title,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    panelRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="op-outline-popover-dismiss-layer"
        aria-hidden="true"
        onPointerDown={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        className={`${OP_POPUP_MENU} ${OP_SG_ON_EDITOR} op-outline-popover`}
        role="dialog"
        aria-label={title}
        aria-modal="false"
        tabIndex={-1}
      >
        <div className="op-outline-popover-header">
          <span>{title}</span>
        </div>
        <div className="op-outline-popover-body">{children}</div>
      </div>
    </>
  );
};
