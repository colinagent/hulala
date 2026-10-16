import React from 'react';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_PRIMARY,
  UI_PILL_BTN_SECONDARY,
} from '../staticGlassCapsule';
import { useBlockingModal } from '../../utils/useBlockingModal';

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  error?: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onPrimary: () => void;
  onSecondary: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  message,
  error,
  primaryLabel,
  secondaryLabel,
  busy,
  onCancel,
  onPrimary,
  onSecondary,
}: DeleteConfirmDialogProps) {
  useBlockingModal(open);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onCancel} />
      <div
        className="relative w-[520px] max-w-[calc(100vw-32px)] rounded border border-border bg-editor-bg shadow-lg p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-2 text-sm text-secondary-text whitespace-pre-wrap">{message}</div>
        {error ? <div className="mt-2 text-sm text-red-400 whitespace-pre-wrap">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className={`${UI_PILL_BTN_SECONDARY} disabled:opacity-50`}
            onClick={onCancel}
            disabled={!!busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_SECONDARY} disabled:opacity-50`}
            onClick={onSecondary}
            disabled={!!busy}
          >
            {secondaryLabel}
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} disabled:opacity-50`}
            onClick={onPrimary}
            disabled={!!busy}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
