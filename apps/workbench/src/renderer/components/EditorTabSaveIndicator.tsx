import React from 'react';
import { rendererI18n } from '../../i18n/renderer';
import type { ConnectionState } from '../services/desktopConnection';
import type { DocumentTab } from '../store/appStore';

type Props = {
  document: Pick<DocumentTab, 'isDirty' | 'filePath' | 'saveFailed' | 'recoveredFromBackup' | 'missing'>;
  connectionState: ConnectionState;
};

export function shouldShowUnsavedIndicator({ document, connectionState }: Props): boolean {
  // Named files normally save after a one-second delay. Keep that routine
  // dirty/save cycle quiet without changing the underlying dirty state.
  return document.isDirty && Boolean(
    !document.filePath
    || document.recoveredFromBackup
    || document.missing
    || document.saveFailed
    || connectionState !== 'connected',
  );
}

export function EditorTabSaveIndicator(props: Props) {
  const visible = shouldShowUnsavedIndicator(props);
  const label = visible ? rendererI18n.t('shell:tab.unsavedChanges') : undefined;
  return (
    <span
      className={`ml-1 flex w-2 shrink-0 items-center justify-center text-secondary-text ${visible ? '' : 'invisible'}`}
      aria-hidden={!visible}
      title={label}
      aria-label={label}
      role="img"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}
