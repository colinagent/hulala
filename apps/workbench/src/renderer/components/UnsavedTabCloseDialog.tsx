import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HulalaLogo } from './Icons';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_DIALOG,
  UI_PILL_BTN_PRIMARY,
} from './staticGlassCapsule';
import { useBlockingModal } from '../utils/useBlockingModal';

type UnsavedTabCloseDialogProps = {
  open: boolean;
  tabTitle: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function UnsavedTabCloseDialog({
  open,
  tabTitle,
  onCancel,
  onConfirm,
}: UnsavedTabCloseDialogProps) {
  const { t } = useTranslation(['dialog', 'common']);
  useBlockingModal(open);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel, onConfirm]);

  if (!open || !tabTitle) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onCancel} />
      <div
        className="relative w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-editor-bg p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-titlebar-bg text-editor-fg shadow-sm">
          <HulalaLogo className="h-10 w-10" title="Hulala" />
        </div>
        <div className="mt-5 text-center">
          <div className="text-[22px] font-semibold leading-8 text-editor-fg">{t('dialog:unsaved.title')}</div>
          <div className="mt-2 text-sm leading-6 text-secondary-text">
            {t('dialog:unsaved.body', { title: tabTitle })}
          </div>
        </div>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className={`dialog-action-btn ${UI_PILL_BTN_DIALOG}`} onClick={onCancel} autoFocus>
            {t('common:cancel')}
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} ${UI_PILL_BTN_DIALOG}`}
            onClick={onConfirm}
          >
            {t('dialog:unsaved.closeAnyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
