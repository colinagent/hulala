import { canonicalFileURI, type CanonicalFileURI } from '../../core/resource/uri';
import type { AppState, EditorTab } from '../../store/appStore';
import type { WorkspaceTabsSessionState } from '../../store/tabManagerStore';
import { dirnamePosix, normalizePosixPath } from '../../utils/markdownMedia';
import type { MarkdownPdfExportPayload } from './types';

const PDF_EXPORT_WORKSPACE_TAB_ID = 'markdown-pdf-export-workspace';
const PDF_EXPORT_EDITOR_TAB_ID = 'markdown-pdf-export-editor';
const PDF_EXPORT_WORKSPACE_ID = 'markdown-pdf-export';

function normalizeOptionalString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureMarkdownExtension(fileName: string): string {
  const trimmed = normalizeOptionalString(fileName) || 'Untitled';
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function resolveAuthorityId(payload: MarkdownPdfExportPayload): string {
  const instanceID = normalizeOptionalString(payload.instanceID);
  if (instanceID) {
    return instanceID;
  }
  const remoteSession = payload.remoteSession;
  if (
    remoteSession &&
    normalizeOptionalString(remoteSession.hostLabel) &&
    normalizeOptionalString(remoteSession.instanceId)
  ) {
    return `remote:${remoteSession.instanceId}`;
  }
  return 'local:default';
}

function resolveSyntheticDocumentPath(payload: MarkdownPdfExportPayload): string | null {
  const sourcePath = normalizeOptionalString(payload.sourcePath);
  if (sourcePath) {
    return normalizePosixPath(sourcePath);
  }
  const currentDir = normalizeOptionalString(payload.currentDir);
  if (!currentDir) {
    return null;
  }
  const fileName = ensureMarkdownExtension(payload.title);
  return normalizePosixPath(`${normalizePosixPath(currentDir)}/${fileName}`);
}

function resolveDocumentTitle(payload: MarkdownPdfExportPayload, documentPath: string | null): string {
  if (documentPath) {
    return documentPath.split('/').pop() || payload.title || 'Untitled';
  }
  return ensureMarkdownExtension(payload.title);
}

function resolveCurrentDir(payload: MarkdownPdfExportPayload, documentPath: string | null): string | null {
  const currentDir = normalizeOptionalString(payload.currentDir);
  if (currentDir) {
    return normalizePosixPath(currentDir);
  }
  if (documentPath) {
    return dirnamePosix(documentPath);
  }
  return null;
}

function buildCanonicalUri(payload: MarkdownPdfExportPayload, documentPath: string | null): CanonicalFileURI | null {
  if (!documentPath || !documentPath.startsWith('/')) {
    return null;
  }
  return canonicalFileURI(resolveAuthorityId(payload), documentPath);
}

export function buildMarkdownPdfExportBootstrapState(payload: MarkdownPdfExportPayload): {
  workspaceSession: WorkspaceTabsSessionState;
  appStatePatch: Partial<AppState>;
  workspaceTabId: string;
  editorTabId: string;
  documentPath: string | null;
} {
  const documentPath = resolveSyntheticDocumentPath(payload);
  const currentFileURI = buildCanonicalUri(payload, documentPath);
  const currentDir = resolveCurrentDir(payload, documentPath);
  const title = resolveDocumentTitle(payload, documentPath);
  const editorTab: EditorTab = {
    id: PDF_EXPORT_EDITOR_TAB_ID,
    title,
    ...(currentFileURI ? { uri: currentFileURI } : {}),
    ...(documentPath ? { filePath: documentPath } : {}),
    editorId: 'markdown',
    content: payload.content,
    isDirty: false,
    pendingScrollHeading: null,
  };

  return {
    workspaceSession: {
      version: 2,
      activeTabId: PDF_EXPORT_WORKSPACE_TAB_ID,
      tabs: [{
        id: PDF_EXPORT_WORKSPACE_TAB_ID,
        label: payload.title || 'Untitled',
        kind: payload.remoteSession ? 'remote' : 'local',
        workspaceId: PDF_EXPORT_WORKSPACE_ID,
        ...(currentDir ? { currentDir } : {}),
        ...(currentDir ? { workspacePath: currentDir } : {}),
      }],
    },
    appStatePatch: {
      remoteSession: payload.remoteSession ?? null,
      baseDir: normalizeOptionalString(payload.baseDir) || null,
      workspaceRootDir: normalizeOptionalString(payload.workspaceRootDir) || null,
      instanceID: normalizeOptionalString(payload.instanceID) || null,
      currentDir,
      currentFileURI,
      currentFilePath: documentPath,
      fileContent: payload.content,
      isDirty: false,
      pendingScrollHeading: null,
      pendingRevealTarget: null,
      editorId: 'markdown',
      editorFocused: false,
      documents: [editorTab],
      activeTabId: PDF_EXPORT_EDITOR_TAB_ID,
    },
    workspaceTabId: PDF_EXPORT_WORKSPACE_TAB_ID,
    editorTabId: PDF_EXPORT_EDITOR_TAB_ID,
    documentPath,
  };
}
