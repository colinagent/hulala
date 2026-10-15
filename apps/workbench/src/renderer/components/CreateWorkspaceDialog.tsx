import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SshHost } from '../store/tabManagerStore';
import { FolderIcon, RemoteIcon } from './Icons';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_DIALOG,
  UI_PILL_BTN_PRIMARY,
} from './staticGlassCapsule';
import { useBlockingModal } from '../utils/useBlockingModal';

type CreateWorkspaceDialogProps = {
  open: boolean;
  name: string;
  remoteHost: SshHost | null;
  busy: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onConnectRemote: () => void;
  onUseLocal: () => void;
};

export function CreateWorkspaceDialog({
  open,
  name,
  remoteHost,
  busy,
  error,
  onNameChange,
  onCancel,
  onSubmit,
  onConnectRemote,
  onUseLocal,
}: CreateWorkspaceDialogProps) {
  const { t } = useTranslation(['dialog', 'common']);
  useBlockingModal(open);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const targetLabel = remoteHost
    ? t('dialog:createWorkspace.remoteTarget', { host: remoteHost.alias })
    : t('dialog:createWorkspace.localTarget');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={() => { if (!busy) onCancel(); }} />
      <div
        className="relative w-[440px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-editor-bg p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="text-xl font-semibold text-editor-fg">{t('dialog:createWorkspace.title')}</div>
        <div className="mt-2 text-sm leading-6 text-secondary-text">{t('dialog:createWorkspace.description')}</div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-titlebar-bg px-3 py-2 text-sm text-prime-text">
          {remoteHost
            ? <RemoteIcon className="h-4 w-4 shrink-0 opacity-75" />
            : <FolderIcon className="h-4 w-4 shrink-0 opacity-75" />}
          <span className="min-w-0 flex-1 truncate">{targetLabel}</span>
        </div>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && name.trim()) onSubmit();
          }}
        >
          <label className="text-xs font-medium text-secondary-text" htmlFor="managed-workspace-name">
            {t('dialog:createWorkspace.nameLabel')}
          </label>
          <input
            id="managed-workspace-name"
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="mt-1.5 w-full rounded border border-border bg-editor-bg px-3 py-2 text-sm text-prime-text outline-none focus:border-active-border"
            placeholder={t('dialog:createWorkspace.namePlaceholder')}
            autoFocus
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
          />
        </form>

        {error ? <div className="mt-2 text-sm text-accent whitespace-pre-wrap">{error}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className={`dialog-action-btn ${UI_PILL_BTN_DIALOG}`}
            onClick={onCancel}
            disabled={busy}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} ${UI_PILL_BTN_DIALOG}`}
            onClick={onSubmit}
            disabled={busy || !name.trim()}
          >
            {busy ? t('common:creating') : t('dialog:createWorkspace.create')}
          </button>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          {remoteHost ? (
            <div className="flex items-center justify-between gap-3">
              <button type="button" className="dialog-text-btn" onClick={onUseLocal} disabled={busy}>
                {t('dialog:createWorkspace.useLocal')}
              </button>
              <button type="button" className="dialog-text-btn" onClick={onConnectRemote} disabled={busy}>
                {t('dialog:createWorkspace.changeRemote')}
              </button>
            </div>
          ) : (
            <button type="button" className="dialog-text-btn flex items-center gap-2" onClick={onConnectRemote} disabled={busy}>
              <RemoteIcon className="h-4 w-4" />
              {t('dialog:createWorkspace.connectRemote')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
