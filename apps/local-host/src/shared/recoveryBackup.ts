export const RECOVERY_BACKUP_VERSION = 1 as const;

export type RecoveryBackupPane = 'main' | 'right';

export type RecoveryBackupIdentity = {
  workspaceTabId: string;
  id: string;
};

export type RecoveryBackupInput = RecoveryBackupIdentity & {
  version: typeof RECOVERY_BACKUP_VERSION;
  title: string;
  content: string;
  editorId: string;
  contentVersion: number;
  uri?: string;
  filePath?: string;
  fileVersion?: string | null;
  pane?: RecoveryBackupPane;
};

export type RecoveryBackupRecord = RecoveryBackupInput & {
  timestamp: number;
};

export function isRecoveryBackupInput(value: unknown): value is RecoveryBackupInput {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const input = value as Partial<RecoveryBackupInput>;
  return input.version === RECOVERY_BACKUP_VERSION
    && typeof input.workspaceTabId === 'string'
    && input.workspaceTabId.trim().length > 0
    && typeof input.id === 'string'
    && input.id.trim().length > 0
    && typeof input.title === 'string'
    && typeof input.content === 'string'
    && typeof input.editorId === 'string'
    && input.editorId.trim().length > 0
    && typeof input.contentVersion === 'number'
    && Number.isSafeInteger(input.contentVersion)
    && input.contentVersion >= 0
    && (input.uri === undefined || typeof input.uri === 'string')
    && (input.filePath === undefined || typeof input.filePath === 'string')
    && (input.fileVersion === undefined || input.fileVersion === null || typeof input.fileVersion === 'string')
    && (input.pane === undefined || input.pane === 'main' || input.pane === 'right');
}

export function isRecoveryBackupRecord(value: unknown): value is RecoveryBackupRecord {
  return isRecoveryBackupInput(value)
    && typeof (value as Partial<RecoveryBackupRecord>).timestamp === 'number'
    && Number.isFinite((value as Partial<RecoveryBackupRecord>).timestamp);
}
