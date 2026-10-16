import React, { useEffect, useRef, useState } from 'react';

import { PopupMenu } from './PopupMenu';
import { PlusIcon } from './Icons';

type ZoomStatusControlProps = {
  label: string;
  percent: string;
  title: string;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
};

function ZoomIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded text-prime-text hover:bg-hover-bg disabled:text-tertiary-text disabled:hover:bg-transparent"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ZoomStatusControl({
  label,
  percent,
  title,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onReset,
}: ZoomStatusControlProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative no-drag" ref={rootRef}>
      <button
        type="button"
        className="ui-statusbar-control"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label} {percent}
      </button>

      {open ? (
        <PopupMenu
          className="absolute bottom-full right-0 z-[60] mb-2 min-w-[250px] rounded-xl p-2"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="min-w-[52px] text-sm font-medium text-prime-text">{percent}</span>
            <ZoomIconButton
              disabled={!canZoomOut}
              label={`${label} zoom out`}
              onClick={onZoomOut}
            >
              <span className="text-xl leading-none">-</span>
            </ZoomIconButton>
            <ZoomIconButton
              disabled={!canZoomIn}
              label={`${label} zoom in`}
              onClick={onZoomIn}
            >
              <PlusIcon className="h-4 w-4" />
            </ZoomIconButton>
            <button
              type="button"
              className="ui-pill-btn-secondary ml-auto border-brand px-4 py-1.5 text-sm font-medium text-brand"
              onClick={() => {
                onReset();
                setOpen(false);
              }}
            >
              Reset
            </button>
          </div>
        </PopupMenu>
      ) : null}
    </div>
  );
}
