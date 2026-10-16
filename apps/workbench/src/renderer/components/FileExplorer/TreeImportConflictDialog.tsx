import React from 'react';
import { useBlockingModal } from '../../utils/useBlockingModal';

type TreeImportConflictDialogProps = {
  open: boolean;
  targetDir: string | null;
  conflicts: string[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onSkip?: () => void;
};

export function TreeImportConflictDialog({
  open,
  targetDir,
  conflicts,
  busy,
  onCancel,
  onConfirm,
  onSkip,
}: TreeImportConflictDialogProps) {
  useBlockingModal(open);

  if (!open) {
    return null;
  }

  const preview = conflicts.slice(0, 8);
  const hiddenCount = Math.max(0, conflicts.length - preview.length);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onCancel} />
      <div
        className="relative w-[560px] max-w-[calc(100vw-32px)] rounded border border-border bg-editor-bg shadow-lg p-4"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold">Overwrite existing files?</div>
        <div className="mt-2 text-sm text-secondary-text whitespace-pre-wrap">
          {`The drop target already contains ${conflicts.length} conflicting path${conflicts.length === 1 ? '' : 's'}.\n\nTarget: ${targetDir || ''}`}
        </div>
        <div className="mt-3 max-h-56 overflow-auto rounded border border-border/70 bg-sidebar-bg/40 px-3 py-2 text-xs text-secondary-text">
          {preview.map((conflict) => (
            <div key={conflict} className="truncate">{conflict}</div>
          ))}
          {hiddenCount > 0 ? (
            <div className="mt-1 text-tertiary-text">+ {hiddenCount} more</div>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="dialog-action-btn"
            onClick={onCancel}
            disabled={!!busy}
          >
            Cancel
          </button>
          {onSkip ? <button type="button" className="dialog-action-btn" onClick={onSkip} disabled={!!busy}>Skip existing</button> : null}
          <button
            type="button"
            className="ui-pill-btn-primary op-sg-capsule op-sg--on-editor px-3 py-1 text-xs"
            onClick={onConfirm}
            disabled={!!busy}
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}
