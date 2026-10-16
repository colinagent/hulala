import React from 'react';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_PRIMARY,
  UI_PILL_BTN_SECONDARY,
} from '../staticGlassCapsule';
import { useBlockingModal } from '../../utils/useBlockingModal';

type RenameEntryDialogProps = {
  open: boolean;
  path: string | null;
  value: string;
  error?: string | null;
  busy?: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function RenameEntryDialog({
  open,
  path,
  value,
  error,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: RenameEntryDialogProps) {
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
        <div className="text-sm font-semibold">Rename</div>
        <div className="mt-2 text-sm text-secondary-text whitespace-pre-wrap">
          {path ? `Rename:\n${path}` : 'Rename selected entry'}
        </div>

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full px-2 py-1 bg-editor-bg border border-border rounded focus:outline-none focus:border-accent"
            autoFocus
          />
        </form>

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
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} disabled:opacity-50`}
            onClick={onSubmit}
            disabled={!!busy}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
