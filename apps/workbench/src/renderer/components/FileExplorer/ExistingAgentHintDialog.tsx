import React from 'react';
import { useBlockingModal } from '../../utils/useBlockingModal';

type ExistingAgentHintDialogProps = {
  open: boolean;
  path: string | null;
  onClose: () => void;
};

export function ExistingAgentHintDialog({ open, path, onClose }: ExistingAgentHintDialogProps) {
  useBlockingModal(open);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onClose} />
      <div
        className="relative w-[520px] max-w-[calc(100vw-32px)] rounded border border-border bg-editor-bg shadow-lg p-4"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold">Agent Already Exists</div>
        <div className="mt-2 text-sm text-secondary-text whitespace-pre-wrap">
          {path
            ? `该目录已经存在 Agent：\n\n${path}\n\n请在对话栏切换 Agent。`
            : '该目录已经存在 Agent，请在对话栏切换 Agent。'}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="dialog-action-btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
