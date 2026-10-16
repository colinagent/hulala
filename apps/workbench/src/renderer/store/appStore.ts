import { sessionStore } from "../../platform/storage";
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useToastStore } from './toastStore';
import { rendererI18n } from '../../i18n/renderer';
import {
  createFileService,
  type FileEntry,
  type FileChange,
  type ReaddirResult,
  type SearchFileResult,
  type StatResult,
} from '../services/fileService';
import {
  createGitService,
  type GitBranch,
  type GitDirtySummary,
} from '../services/gitService';
import {
  createMessengerService,
  type MessengerReplyInput,
} from '../services/messengerService';
import { useMessengerStore } from './messengerStore';
import {
  EditorViewStateMemento,
  type EditorViewState,
  type EditorViewStateIdentity,
  type EditorViewStateKind,
} from './editorViewState';
import {
  CRON_TASK_HISTORY_LIMIT,
  createCronService,
  type CronRunResult,
  type CronTaskHistoryEntry,
  type CronTask,
  type CronTaskRecord,
} from '../services/cronService';
import {
  DesktopConnection,
  type ConnectionCallbacks,
  type ConnectionState,
} from '../services/desktopConnection';
import { useTabManagerStore } from './tabManagerStore';
import { upsertSingletonEditorTab } from './singletonEditorTab';
import { NEW_TAB_TITLE, retargetActiveBlankNewTab } from './newEditorTab';
import { movePaneDocument } from './editorPaneState';
import { useRightWorkspaceStore } from './rightWorkspaceStore';
import { dirnamePosix, normalizePosixPath } from '../utils/markdownMedia';
import { base64ToFile, importFile, uploadFileToPath } from '../services/resourceService';
import { canonicalFileURI, isAbsoluteResourcePath, normalizeResourcePath, type CanonicalFileURI } from '../core/resource/uri';
import {
  getNormalizedFileExtension,
  isFileExtensionOpenable,
} from '../utils/fileExtensionPolicy';
import {
  RECOVERY_BACKUP_VERSION,
  type RecoveryBackupRecord,
} from '../../shared/recoveryBackup';

const EMPTY_ENTRIES: FileEntry[] = [];

export type EditorRevealTarget = {
  line: number;
  column?: number;
};

export type BookHighlightRectTarget = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type BookOpenTarget =
  | { format: 'epub'; cfi: string; text?: string | null }
  | {
      format: 'pdf';
      page: number;
      rects?: BookHighlightRectTarget[];
      text?: string | null;
    };

export type SidebarSearchFlags = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type EditorPane = 'main' | 'right';
export type RightPaneToolTab = 'outline' | 'activity';
export type RightPaneTabKey = RightPaneToolTab | `file:${string}`;

export type EditorTab = {
  id: string;
  title: string;
  uri?: CanonicalFileURI;
  filePath?: string;
  editorId: string;
  content: string;
  fileVersion?: string | null;
  isDirty: boolean;
  saveFailed?: boolean;
  recoveredFromBackup?: boolean;
  missing?: boolean;
  resourceVersion?: number;
  pendingScrollHeading: string | null;
  pendingRevealTarget?: EditorRevealTarget | null;
  pendingBookTarget?: BookOpenTarget | null;
  documentRole?: 'editor';
  threadID?: string;
  pane?: EditorPane;
};

export type DocumentTab = EditorTab;

export type PendingDirtyTabClose = {
  tabId: string;
  title: string;
  focusEditor: boolean;
};

export type EditorFocusRequest = {
  tabId: string;
  seq: number;
};

export type RemoteSessionInfo = {
  hostLabel: string;
  workspaceDir: string;
  instanceId: string;
  runtimeVersion: string;
  platform: string;
  arch: string;
};

type DerivedDirs = {
  baseDir: string;
  workspaceDir: string;
  instanceID: string;
};

type VisibleTreeSnapshot = {
  remoteIdentity: string;
  currentDir: string | null;
  expandedDirs: string[];
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getFileTitle(path: string) {
  return path.split('/').pop() || path;
}

function authorityIdFromState(
  state: Pick<AppState, 'instanceID' | 'remoteSession'>,
): string {
  const instanceID = (state.instanceID || '').trim();
  if (instanceID) {
    return instanceID;
  }
  const session = state.remoteSession;
  if (session?.instanceId) return `remote:${session.instanceId}`;
  return 'local:default';
}

function pathToDocumentURI(
  path: string | null | undefined,
  state: Pick<AppState, 'instanceID' | 'remoteSession'>,
): CanonicalFileURI | null {
  const normalized = normalizeResourcePath(path || '');
  if (!normalized || !isAbsoluteResourcePath(normalized)) {
    return null;
  }
  return canonicalFileURI(authorityIdFromState(state), normalized);
}

function matchesDocumentTab(
  tab: Pick<DocumentTab, 'uri' | 'filePath'>,
  path: string,
  uri: CanonicalFileURI | null | undefined,
): boolean {
  if (uri && tab.uri) {
    if (tab.uri === uri) return true;
  }
  // A view store stays bound to one Workspace. Runtime connection epochs may
  // change its URI authority, but do not turn the same path into a new file.
  return normalizePosixPath((tab.filePath || '').trim())
    === normalizePosixPath((path || '').trim());
}

function resolveDocumentRole(
  _content: string,
  _editorId: string,
): 'editor' {
  return 'editor';
}

function normalizeDocumentTab(tab: DocumentTab): DocumentTab {
  const documentRole = resolveDocumentRole(tab.content, tab.editorId);
  return {
    ...tab,
    saveFailed: tab.isDirty ? tab.saveFailed : false,
    documentRole,
    threadID: undefined,
    pane: tab.pane === 'right' ? 'right' : 'main',
  };
}

function ensureDocumentTabURI(
  tab: DocumentTab,
  state: Pick<AppState, 'instanceID' | 'remoteSession'>,
): DocumentTab {
  if (tab.uri || !(tab.filePath || '').trim()) {
    return tab;
  }
  const uri = pathToDocumentURI(tab.filePath, state);
  return uri ? { ...tab, uri } : tab;
}

function isBinaryPreviewDocumentTab(
  tab: Pick<DocumentTab, 'editorId'> | null | undefined,
): boolean {
  return (
    tab?.editorId === 'image' ||
    tab?.editorId === 'pdf' ||
    tab?.editorId === 'book' ||
    tab?.editorId === 'word'
  );
}

export function getEditorDocuments(
  documents: DocumentTab[],
  pane: EditorPane = 'main',
): DocumentTab[] {
  return documents.filter((tab) => (tab.pane === 'right' ? 'right' : 'main') === pane);
}

function getOpenDocuments(state: Pick<AppState, 'documents'>): DocumentTab[] {
  return state.documents;
}

function isSameOrChildPath(
  path: string | null | undefined,
  rootPath: string,
): boolean {
  const candidate = (path || '').trim();
  return candidate === rootPath || candidate.startsWith(`${rootPath}/`);
}

function replaceMovedPath(
  path: string | null | undefined,
  ops: Array<{ oldPath: string; newPath: string }>,
): string | null {
  const candidate = (path || '').trim();
  if (!candidate) {
    return null;
  }
  for (const { oldPath, newPath } of ops) {
    if (candidate === oldPath) {
      return newPath;
    }
    if (candidate.startsWith(`${oldPath}/`)) {
      return `${newPath}${candidate.slice(oldPath.length)}`;
    }
  }
  return candidate;
}

function replaceMovedEntries(
  dir: string,
  entries: FileEntry[],
  ops: Array<{ oldPath: string; newPath: string }>,
): FileEntry[] {
  let changed = false;
  const nextEntries = entries.map((entry) => {
    const entryPath = normalizePosixPath(
      `${dir.replace(/\/+$/, '')}/${entry.name}`,
    );
    const nextPath = replaceMovedPath(entryPath, ops);
    if (!nextPath || nextPath === entryPath) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      name: getFileTitle(nextPath),
    };
  });
  return changed ? nextEntries : entries;
}

function formatImageTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}${millis}`;
}

function buildPastedImageMarkdown(relativePath: string, altText?: string) {
  const rawPath = (relativePath || '').trim();
  const normalizedPath = normalizePosixPath(rawPath);
  const trimmedPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `./${normalizedPath.replace(/^\.?\//, '')}`;
  const fallback =
    trimmedPath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/i, '') || 'image';
  const alt = (altText || '').trim() || fallback;
  return `![${alt}](${trimmedPath})`;
}

function normalizeImageExtension(extension: string) {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) {
    return '.png';
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function toActiveState(tab: EditorTab) {
  return {
    currentFileURI: tab.uri || null,
    currentFilePath: tab.filePath || null,
    fileContent: tab.content,
    isDirty: tab.isDirty,
    pendingScrollHeading: tab.pendingScrollHeading,
    pendingRevealTarget: tab.pendingRevealTarget || null,
    pendingBookTarget: tab.pendingBookTarget || null,
    editorId: tab.editorId,
    editorFocusRequest: null,
  };
}

function nextEditorFocusRequest(
  state: { editorFocusRequest: EditorFocusRequest | null },
  tabId: string | null | undefined,
  shouldFocus: boolean,
): EditorFocusRequest | null {
  const id = (tabId || '').trim();
  if (!shouldFocus || !id) {
    return null;
  }
  return {
    tabId: id,
    seq: (state.editorFocusRequest?.seq ?? 0) + 1,
  };
}

function isMovableEditorTab(tab: EditorTab | null | undefined): boolean {
  return Boolean((tab?.filePath || '').trim());
}

function resolvePaneActiveTabId(
  activeTabId: string | undefined,
  pane: EditorPane,
  tabs: EditorTab[],
): string | undefined {
  const paneTabs = getEditorDocuments(tabs, pane);
  if (activeTabId && paneTabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return paneTabs[0]?.id;
}

function patchDocumentsWithPaneState(
  state: Pick<
    AppState,
    | 'instanceID'
    | 'remoteSession'
    | 'mainActiveTabId'
    | 'rightActiveTabId'
    | 'rightPaneOpen'
    | 'outlineTabOpen'
    | 'activityPanelPinnedRight'
    | 'rightPaneActiveTabKey'
  >,
  tabs: DocumentTab[],
): Pick<
  AppState,
  | 'documents'
  | 'mainActiveTabId'
  | 'rightActiveTabId'
  | 'rightPaneOpen'
  | 'rightPaneActiveTabKey'
> {
  const documents = tabs.map((tab) =>
    normalizeDocumentTab(ensureDocumentTabURI(tab, state)),
  );
  const mainActiveTabId = resolvePaneActiveTabId(state.mainActiveTabId, 'main', documents);
  const rightActiveTabId = resolvePaneActiveTabId(state.rightActiveTabId, 'right', documents);
  let rightPaneActiveTabKey = state.rightPaneActiveTabKey;
  if (rightPaneActiveTabKey?.startsWith('file:')) {
    const tabId = rightPaneActiveTabKey.slice('file:'.length);
    if (!documents.some((tab) => tab.id === tabId && tab.pane === 'right')) {
      rightPaneActiveTabKey = undefined;
    }
  } else if (rightPaneActiveTabKey === 'outline' && !state.outlineTabOpen) {
    rightPaneActiveTabKey = undefined;
  } else if (rightPaneActiveTabKey === 'activity' && !state.activityPanelPinnedRight) {
    rightPaneActiveTabKey = undefined;
  }
  if (!rightPaneActiveTabKey) {
    rightPaneActiveTabKey = rightActiveTabId
      ? `file:${rightActiveTabId}`
      : state.outlineTabOpen
        ? 'outline'
        : state.activityPanelPinnedRight
          ? 'activity'
          : undefined;
  }
  return {
    documents,
    mainActiveTabId,
    rightActiveTabId,
    rightPaneOpen: state.rightPaneOpen,
    rightPaneActiveTabKey,
  };
}

// Keep the document-normalization call sites compact while the pane-aware
// state replaces the former single pinned-file slot.
const patchDocumentsWithPinnedState = patchDocumentsWithPaneState;

export type GitInfo = {
  status: 'idle' | 'loading' | 'ready';
  error: string | null;
  isRepo: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  detached: boolean;
  detachedLabel: string | null;
  branches: GitBranch[];
  dirty: GitDirtySummary;
  loadedPath: string | null;
};

const EMPTY_GIT_DIRTY: GitDirtySummary = {
  changedFiles: 0,
  addedLines: 0,
  deletedLines: 0,
  hasChanges: false,
};

function createEmptyGitInfo(): GitInfo {
  return {
    status: 'idle',
    error: null,
    isRepo: false,
    repoRoot: null,
    currentBranch: null,
    detached: false,
    detachedLabel: null,
    branches: [],
    dirty: { ...EMPTY_GIT_DIRTY },
    loadedPath: null,
  };
}

interface AppState {
  // Connection state
  connectionState: ConnectionState;
  serverUrl: string;
  remoteSession: RemoteSessionInfo | null;
  remoteConnecting: boolean;
  remoteError: string | null;
  baseDir: string | null;
  workspaceRootDir: string | null;
  instanceID: string | null;

  // File system state
  currentDir: string | null;
  entries: FileEntry[];
  dirEntries: Map<string, FileEntry[]>;
  dirLoading: Set<string>;
  dirErrors: Map<string, string>;
  dirWatchIds: Map<string, string>;
  expandedDirs: Set<string>;
  requestRootAction: 'new-file' | 'new-folder' | null;
  sidebarSearchQuery: string;
  sidebarSearchIncludes: string;
  sidebarSearchExcludes: string;
  sidebarSearchFlags: SidebarSearchFlags;
  sidebarSearchLoading: boolean;
  sidebarSearchError: string | null;
  sidebarSearchResults: SearchFileResult[];
  sidebarSearchTotalCount: number;
  sidebarSearchTruncated: boolean;
  sidebarSearchRequestSeq: number;

  gitInfo: GitInfo;

  // Editor state
  currentFileURI: CanonicalFileURI | null;
  currentFilePath: string | null;
  fileContent: string;
  isDirty: boolean;
  pendingScrollHeading: string | null;
  pendingRevealTarget: EditorRevealTarget | null;
  pendingBookTarget: BookOpenTarget | null;
  editorId: string | null; // 'markdown' | 'text' | etc.
  editorFocused: boolean;
  editorBlurRequestSeq: number;
  editorFocusRequest: EditorFocusRequest | null;
  documents: DocumentTab[];
  activeTabId?: string;
  mainActiveTabId?: string;
  rightActiveTabId?: string;
  focusedEditorPane: EditorPane;
  rightPaneOpen: boolean;
  rightPaneActiveTabKey?: RightPaneTabKey;
  outlineTabOpen: boolean;
  activityPanelPinnedRight: boolean;
  pendingDirtyTabClose: PendingDirtyTabClose | null;

  // Actions
  connect: () => void;
  setServerUrl: (url: string) => void;
  setRemoteSession: (session: RemoteSessionInfo | null) => void;
  setRemoteConnecting: (next: boolean) => void;
  setRemoteError: (next: string | null) => void;
  disconnect: () => void;
  reconnectNow: () => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
  setActive: (active: boolean) => void;
  setCurrentDir: (dir: string) => void;
  setRequestRootAction: (action: 'new-file' | 'new-folder' | null) => void;
  setSidebarSearchQuery: (value: string) => void;
  setSidebarSearchIncludes: (value: string) => void;
  setSidebarSearchExcludes: (value: string) => void;
  setSidebarSearchFlag: (
    flag: keyof SidebarSearchFlags,
    value: boolean,
  ) => void;
  clearSidebarSearchState: () => void;
  runSidebarSearch: (options?: { installRetry?: boolean }) => Promise<void>;
  refreshGitInfo: (path?: string) => Promise<void>;
  listCronTasks: () => Promise<CronTaskRecord[]>;
  getCronTask: (id: string) => Promise<CronTaskRecord | null>;
  updateCronTask: (task: CronTask) => Promise<CronTaskRecord>;
  runCronTask: (id: string) => Promise<CronRunResult>;
  listCronTaskHistory: (id: string, limit?: number) => Promise<CronTaskHistoryEntry[]>;
  ensureDirectory: (dir: string) => Promise<void>;
  loadDirectory: (dir: string) => Promise<void>;
  readDirectory: (dir: string) => Promise<FileEntry[]>;
  listDirectory: (dir: string) => Promise<ReaddirResult>;
  statPath: (path: string) => Promise<StatResult & { error?: string }>;
  toggleDir: (dir: string) => void;
  openFile: (
    path: string,
    options?: {
      fresh?: boolean;
      heading?: string;
      reveal?: EditorRevealTarget;
      bookTarget?: BookOpenTarget;
      focusEditor?: boolean;
      pane?: EditorPane;
    },
  ) => Promise<void>;
  openWelcomeTab: () => void;
  openCommandsTab: () => void;
  openCronTaskTab: (id: string, title?: string) => void;
  openPluginTab: (id: string, title?: string) => void;
  openUntitledTab: () => void;
  retargetActiveBlankTab: (
    newPath: string,
    title?: string,
    content?: string,
  ) => boolean;
  retargetTabPath: (oldPath: string, newPath: string, title?: string) => void;
  retargetMovedTabs: (ops: Array<{ oldPath: string; newPath: string }>) => void;
  setActiveTab: (tabId: string, options?: { focusEditor?: boolean }) => void;
  moveTabToPane: (tabId: string, pane: EditorPane) => boolean;
  setFocusedEditorPane: (pane: EditorPane) => void;
  setRightPaneOpen: (open: boolean) => void;
  selectRightPaneTab: (key: RightPaneTabKey) => void;
  openOutlineInRightPane: () => void;
  closeOutlineInRightPane: () => void;
  setActivityPanelPinnedRight: (pinned: boolean) => void;
  resetEditorPaneLayout: () => void;
  activateLastPrimaryTab: (options?: {
    excludeTabId?: string | null;
  }) => boolean;
  closeTab: (tabId: string, options?: { focusEditor?: boolean }) => void;
  dismissPendingDirtyTabClose: () => void;
  confirmPendingDirtyTabClose: () => void;
  closeOtherTabs: (tabId: string, options?: { focusEditor?: boolean }) => void;
  closeAllTabs: () => void;
  saveFile: (options?: { tabId?: string; saveAs?: boolean }) => Promise<void>;
  saveTabByPath: (path: string, tabId?: string) => Promise<boolean>;
  flushDirtyTabs: () => Promise<{ saved: number; failed: string[] }>;
  setFileContent: (content: string) => void;
  setTabContent: (tabId: string, content: string) => void;
  saveEditorViewState: (
    identity: EditorViewStateIdentity,
    viewState: EditorViewState,
  ) => void;
  loadEditorViewState: (
    identity: EditorViewStateIdentity,
    kind: EditorViewStateKind,
  ) => EditorViewState | null;
  setPendingScrollHeading: (heading: string | null) => void;
  setPendingRevealTarget: (reveal: EditorRevealTarget | null) => void;
  setPendingBookTarget: (target: BookOpenTarget | null) => void;
  setEditorFocused: (focused: boolean) => void;
  requestEditorFocus: (tabId?: string | null) => boolean;
  consumeEditorFocusRequest: (tabId: string) => boolean;
  requestEditorRandomID: () => Promise<string | null>;
  requestEditorBlur: () => void;
  refreshMessenger: () => Promise<void>;
  loadMessengerChannel: (channelID: string) => Promise<void>;
  replyMessenger: (input: MessengerReplyInput) => Promise<void>;
  markMessengerRead: (channelIDs?: string[]) => Promise<void>;
  archiveMessengerChannel: (channelID: string) => Promise<void>;
  createFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  createFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
  deleteEntry: (
    path: string,
    isDir: boolean,
    options?: { useTrash?: boolean; recursive?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  moveEntries: (
    ops: Array<{ oldPath: string; newPath: string }>,
  ) => Promise<{ success: boolean; error?: string }>;
  copyEntries: (
    ops: Array<{ sourcePath: string; targetPath: string }>,
  ) => Promise<{ success: boolean; error?: string }>;
  renameEntry: (
    oldPath: string,
    newPath: string,
  ) => Promise<{ success: boolean; error?: string }>;
  persistPastedImage: (
    base64: string,
    documentPath?: string | null,
  ) => Promise<{ markdown?: string; documentRef?: string; error?: string }>;

  // File helpers
  readTextFile: (path: string) => Promise<string | null>;
  writeTextFile: (path: string, content: string, baseline?: string | null) => Promise<boolean>;
  writeBase64File: (
    path: string,
    base64: string,
    options?: { overwrite?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  ensureDerivedDirs: (opts?: {
    force?: boolean;
  }) => Promise<DerivedDirs | null>;

  // Sidebar helpers
  refreshVisibleWorkspaceTree: () => Promise<void>;
  revealInSidebar: (path: string) => Promise<void>;

  // Backup helpers
  restoreBackups: () => Promise<void>;
  reloadOpenTabsByPaths: (
    paths: string[],
    options?: { skipDirty?: boolean },
  ) => Promise<void>;
  reloadOpenTabsFromDisk: () => Promise<void>;
  reloadVisibleWorkspaceAfterGitChange: () => Promise<void>;
  checkoutGitBranch: (
    branch: string,
    options?: { create?: boolean },
  ) => Promise<{
    success: boolean;
    error?: string;
    currentBranch?: string;
  }>;
}

export type WorkspaceStore = StoreApi<AppState>;
export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

type AppStoreHook = {
  <T = AppState>(selector?: (state: AppState) => T): T;
  getState: () => AppState;
  getStateByTabId: (tabId: string) => AppState;
  getStoreByTabId: (tabId: string) => WorkspaceStore;
};

// UI copy should follow the active workspace transition instead of a stale socket
// state left over from the previously connected workspace.
export function getDisplayConnectionState(
  state: Pick<AppState, 'connectionState' | 'remoteConnecting'>,
): ConnectionState {
  return state.remoteConnecting ? 'connecting' : state.connectionState;
}

export function getConnectionStateText(state: ConnectionState): string {
  const key =
    state === 'connected'
      ? 'shell:connection.connected'
      : state === 'connecting'
        ? 'shell:connection.connecting'
        : state === 'reconnecting'
          ? 'shell:connection.reconnecting'
          : 'shell:connection.disconnected';
  return rendererI18n.t(key);
}

const workspaceStores = new Map<string, WorkspaceStore>();
type WorkspaceContextConfig = {
  baseDir: string;
  defaultWorkspace: string;
  instanceID: string;
};

const systemConfigByInstanceID = new Map<string, WorkspaceContextConfig>();
const instanceIDByServerUrl = new Map<string, string>();
const systemConfigInflightByServerUrl = new Map<
  string,
  Promise<DerivedDirs | null>
>();
let localRuntimeServerUrl = '';
export function setLocalRuntimeEndpoint(endpointUrl: string): void {
  if (!endpointUrl.trim()) throw new Error('A local Runtime endpoint is required');
  localRuntimeServerUrl = endpointUrl;
  for (const store of workspaceStores.values()) {
    if (!store.getState().remoteSession) store.getState().setServerUrl(endpointUrl);
  }
}

function normalizeDirPath(input: string): string {
  const value = input.trim();
  if (!value) return '';
  if (value === '/') return '/';
  return value.replace(/\/+$/, '');
}

function deriveDirsFromConfig(
  cfg: WorkspaceContextConfig | null | undefined,
): DerivedDirs | null {
  const baseDirRaw = typeof cfg?.baseDir === 'string' ? cfg.baseDir : '';
  const defaultWorkspaceRaw =
    typeof cfg?.defaultWorkspace === 'string' ? cfg.defaultWorkspace : '';
  const hostIDRaw = typeof cfg?.instanceID === 'string' ? cfg.instanceID : '';
  const baseDir = normalizeDirPath(baseDirRaw);
  const defaultWorkspace = normalizeDirPath(defaultWorkspaceRaw);
  const instanceID = hostIDRaw.trim();
  if (!baseDir || !defaultWorkspace || !instanceID) {
    return null;
  }
  return {
    baseDir,
    workspaceDir: defaultWorkspace,
    instanceID,
  };
}

function buildRemoteSessionIdentity(
  session: RemoteSessionInfo | null | undefined,
): string | null {
  if (!session) {
    return null;
  }
  const workspaceDir = normalizeDirPath(session.workspaceDir || '');
  const hostLabel = (session.hostLabel || '').trim();
  if (!workspaceDir || !hostLabel || !session.instanceId) {
    return null;
  }
  return [hostLabel, workspaceDir, session.instanceId].join('|');
}

function isPathInsideRoot(
  path: string | null | undefined,
  root: string | null | undefined,
): boolean {
  const target = normalizeDirPath(path || '');
  const base = normalizeDirPath(root || '');
  if (!target || !base) {
    return false;
  }
  return target === base || target.startsWith(`${base}/`);
}

function isPathInVisibleRoots(
  path: string | null | undefined,
  derived: DerivedDirs | null,
): boolean {
  if (!path || !derived) {
    return false;
  }
  return isPathInsideRoot(path, derived.workspaceDir);
}

function isAbsoluteDirPath(path: string | null | undefined): boolean {
  const normalized = normalizeDirPath(path || '');
  if (!normalized) {
    return false;
  }
  return normalized === '/' || normalized.startsWith('/');
}

function uniqueDirs(input: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of input) {
    const dir = normalizeDirPath(value || '');
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    result.push(dir);
  }
  return result;
}

function isTransientDirectoryLoadError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes('timeout')
    || normalized.includes('not connected')
    || normalized.includes('connection disposed')
    || normalized.includes('connection timed out');
}

function parseSidebarSearchGlobs(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function createWorkspaceStore(workspaceTabId: string): WorkspaceStore {
  const editorViewStates = new EditorViewStateMemento(200, sessionStore, 'hulala.editor-positions.' + workspaceTabId);
  const connection = new DesktopConnection(workspaceTabId);
  const fileService = createFileService(workspaceTabId);
  const gitService = createGitService(workspaceTabId);
  const cronService = createCronService(workspaceTabId);
  const messengerService = createMessengerService(connection);
  const FILE_CHANGE_DEBOUNCE_MS = 300;
  const AUTO_SAVE_DELAY_MS = 1000;
  const AUTO_SAVE_RETRY_DELAY_MS = 2000;
  const pendingDirs = new Set<string>();
  const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const backupVersions = new Map<string, number>();
  let fileChangeTimer: ReturnType<typeof setTimeout> | null = null;
  let getState: (() => AppState) | null = null;
  let setState: StoreApi<AppState>['setState'] | null = null;
  let pendingEnsureDir: string | null = null;
  let visibleTreeSnapshot: VisibleTreeSnapshot | null = null;
  let gitInfoRequestSeq = 0;
  let recoveryBackupsRestored = false;
  const registerRightWorkspaceFile = (tabId: string) => {
    const sourceTab = useTabManagerStore.getState().tabs.find(
      (tab) => tab.id === workspaceTabId,
    );
    useRightWorkspaceStore.getState().addFile({
      workspaceTabId,
      tabId,
      ...(sourceTab
        ? {
            source: {
              kind: sourceTab.kind,
              workspacePath: sourceTab.workspacePath,
              remoteHost: sourceTab.remoteHost,
              label: sourceTab.label,
              workspaceId: sourceTab.workspaceId,
            },
          }
        : {}),
    });
  };
  const clearVisibleTreeSnapshot = () => {
    visibleTreeSnapshot = null;
  };

  const captureVisibleTreeSnapshot = (state: AppState) => {
    const remoteIdentity = buildRemoteSessionIdentity(state.remoteSession);
    if (!remoteIdentity) {
      visibleTreeSnapshot = null;
      return;
    }
    visibleTreeSnapshot = {
      remoteIdentity,
      currentDir: normalizeDirPath(state.currentDir || '') || null,
      expandedDirs: uniqueDirs(Array.from(state.expandedDirs)),
    };
  };

  const getCachedDerivedDirsByServerUrl = (
    serverUrl: string,
  ): DerivedDirs | null => {
    const url = (serverUrl || '').trim();
    if (!url) {
      return null;
    }
    const instanceID = instanceIDByServerUrl.get(url);
    if (!instanceID) {
      return null;
    }
    const cachedConfig = systemConfigByInstanceID.get(instanceID);
    return deriveDirsFromConfig(cachedConfig);
  };

  const ensureSystemConfig = async (opts?: {
    force?: boolean;
    attempts?: number;
  }): Promise<DerivedDirs | null> => {
    const snapshot = getState?.();
    if (!snapshot || snapshot.connectionState !== 'connected') {
      return null;
    }
    const serverUrl = (snapshot.serverUrl || '').trim();
    if (!serverUrl) {
      return null;
    }
    const force = opts?.force === true;
    const cached = getCachedDerivedDirsByServerUrl(serverUrl);
    if (!force && cached) {
      return cached;
    }
    const pending = systemConfigInflightByServerUrl.get(serverUrl);
    if (pending) {
      return pending;
    }
    const request = window.hulala!.desktop
      .workspaceContext(workspaceTabId, snapshot.currentDir || undefined)
      .then((result: { instanceId: string; workspace: { path: string } }) => {
        const cfg: WorkspaceContextConfig = {
          baseDir: result.workspace.path,
          defaultWorkspace: result.workspace.path,
          instanceID: result.instanceId,
        };
        const derived = deriveDirsFromConfig(cfg);
        if (derived) {
          instanceIDByServerUrl.set(serverUrl, derived.instanceID);
          systemConfigByInstanceID.set(
            derived.instanceID,
            cfg,
          );
          return derived;
        }
        instanceIDByServerUrl.delete(serverUrl);
        return null;
      })
      .finally(() => {
        systemConfigInflightByServerUrl.delete(serverUrl);
      });
    systemConfigInflightByServerUrl.set(serverUrl, request);
    return request;
  };

  const flushFileChanges = () => {
    fileChangeTimer = null;
    if (pendingDirs.size === 0) {
      return;
    }
    const dirs = Array.from(pendingDirs);
    pendingDirs.clear();
    dirs.forEach((dir) => {
      getState?.().loadDirectory(dir);
    });
  };

  const scheduleFileChangeRefresh = (dirs: Iterable<string>) => {
    for (const dir of dirs) {
      pendingDirs.add(dir);
    }
    if (fileChangeTimer) {
      clearTimeout(fileChangeTimer);
    }
    fileChangeTimer = setTimeout(flushFileChanges, FILE_CHANGE_DEBOUNCE_MS);
  };

  const store = createStore<AppState>((set, get) => {
    getState = get;
    setState = set;

    const buildConnectionCallbacks = (): ConnectionCallbacks => ({
      onStateChange: (state: ConnectionState) => {
        set({ connectionState: state });
      },
      onConnect: () => {
        void (async () => {
          const derived = await ensureSystemConfig({ force: true, attempts: 12 });
          set({
            baseDir: derived?.baseDir || null,
            workspaceRootDir: derived?.workspaceDir || null,
            instanceID: derived?.instanceID || null,
          });
          await restoreVisibleTreeAfterConnect(derived);
          await get().refreshGitInfo();
          await get().refreshMessenger();
          for (const tab of getOpenDocuments(get()).filter((item) => item.isDirty)) {
            stageRecoveryBackup(tab);
            if (tab.filePath && !tab.recoveredFromBackup) {
              scheduleAutoSave(
                tab.filePath,
                tab.uri || pathToDocumentURI(tab.filePath, get()),
                tab.content,
              );
            }
          }
        })();
      },
      onDisconnect: () => {
        captureVisibleTreeSnapshot(get());
        set({
          dirWatchIds: new Map(),
          gitInfo: createEmptyGitInfo(),
        });
      },
      onMessengerMessage: (message) => {
        if (useTabManagerStore.getState().activeTabId !== workspaceTabId) return;
        const previous = useMessengerStore.getState().recordsByID[message.id];
        useMessengerStore.getState().upsertRecord(message);
        if (!previous && message.sender !== 'user' && message.status === 'open') useToastStore.getState().pushToast(message.title || 'New Workspace message', { durationMs: 6000 });
      },
      onFileChange: (changes: FileChange[]) => {
        const state = get();
        const dirs = new Set<string>();
        const changedPaths: string[] = [];
        for (const change of changes) {
          const changedPath = normalizePosixPath(change.path);
          if (!changedPath) continue;
          changedPaths.push(changedPath);
          const dir = changedPath.substring(0, changedPath.lastIndexOf('/'));
          if (dir === state.currentDir || state.expandedDirs.has(dir)) dirs.add(dir);
        }
        if (dirs.size > 0) scheduleFileChangeRefresh(dirs);
        if (changedPaths.length > 0) void reloadOpenTabsByPaths(changedPaths, { skipDirty: true });
      },
    });

    const discardAutoSave = (path: string | null | undefined) => {
      if (!path) {
        return;
      }
      const handle = autoSaveTimers.get(path);
      if (handle) {
        clearTimeout(handle);
        autoSaveTimers.delete(path);
      }
    };

    const deleteRecoveryBackup = (tabId: string) => {
      backupVersions.delete(tabId);
      window.hulala?.backup?.delete?.({ workspaceTabId, id: tabId }).catch(() => {});
    };

    const closeTabNow = (tabId: string, focusEditor = false) => {
      const state = get();
      const tab = getOpenDocuments(state).find((item) => item.id === tabId);
      if (!tab) {
        set({ pendingDirtyTabClose: null });
        return;
      }

      editorViewStates.forgetTab(tabId);

      discardAutoSave(tab.filePath);
      deleteRecoveryBackup(tab.id);

      set((current) => {
        const closingTab = getOpenDocuments(current).find((item) => item.id === tabId);
        const closingPane: EditorPane = closingTab?.pane === 'right' ? 'right' : 'main';
        const paneTabs = getEditorDocuments(current.documents, closingPane);
        const index = paneTabs.findIndex((item) => item.id === tabId);
        if (index === -1) {
          return { pendingDirtyTabClose: null };
        }
        const nextTabs = getOpenDocuments(current).filter(
          (item) => item.id !== tabId,
        );
        const nextPaneTabs = getEditorDocuments(nextTabs, closingPane);
        const shouldPickNext = current.activeTabId === tabId;
        const nextPaneTab = nextPaneTabs[index] || nextPaneTabs[index - 1];
        const patch = patchDocumentsWithPaneState(current, nextTabs);
        const mainActiveTabId = closingPane === 'main'
          ? nextPaneTab?.id
          : patch.mainActiveTabId;
        const rightActiveTabId = closingPane === 'right'
          ? nextPaneTab?.id
          : patch.rightActiveTabId;
        if (!shouldPickNext) {
          return {
            ...patch,
            mainActiveTabId,
            rightActiveTabId,
            rightPaneActiveTabKey: closingPane === 'right' && current.rightPaneActiveTabKey === `file:${tabId}`
              ? rightActiveTabId
                ? `file:${rightActiveTabId}`
                : current.outlineTabOpen
                  ? 'outline'
                  : current.activityPanelPinnedRight
                    ? 'activity'
                    : undefined
              : patch.rightPaneActiveTabKey,
            pendingDirtyTabClose: null,
            editorFocusRequest: nextEditorFocusRequest(
              current,
              current.activeTabId,
              focusEditor,
            ),
          };
        }
        const nextActiveTab = nextPaneTab
          || (closingPane === 'main'
            ? rightActiveTabId && nextTabs.find((item) => item.id === rightActiveTabId)
            : mainActiveTabId && nextTabs.find((item) => item.id === mainActiveTabId));
        if (!nextActiveTab) {
          return {
            ...patch,
            activeTabId: undefined,
            mainActiveTabId,
            rightActiveTabId,
            currentFileURI: null,
            currentFilePath: null,
            fileContent: '',
            isDirty: false,
            pendingScrollHeading: null,
            pendingRevealTarget: null,
            pendingBookTarget: null,
            editorId: null,
            editorFocusRequest: null,
            pendingDirtyTabClose: null,
          };
        }
        return {
          ...patch,
          activeTabId: nextActiveTab.id,
          mainActiveTabId,
          rightActiveTabId,
          focusedEditorPane: nextActiveTab.pane === 'right' ? 'right' : 'main',
          rightPaneActiveTabKey: nextActiveTab.pane === 'right'
            ? `file:${nextActiveTab.id}`
            : patch.rightPaneActiveTabKey,
          pendingDirtyTabClose: null,
          ...toActiveState(nextActiveTab),
          editorFocusRequest: nextEditorFocusRequest(
            current,
            nextActiveTab.id,
            focusEditor,
          ),
        };
      });
      void syncWatches();
    };

    const stageRecoveryBackup = (tab: EditorTab) => {
      if (!window.hulala?.backup?.stage) {
        return;
      }
      if (!tab.filePath && tab.content === '') { deleteRecoveryBackup(tab.id); return; }
      const contentVersion = (backupVersions.get(tab.id) ?? 0) + 1;
      backupVersions.set(tab.id, contentVersion);
      window.hulala.backup.stage({
        version: RECOVERY_BACKUP_VERSION,
        workspaceTabId,
        id: tab.id,
        title: tab.title,
        content: tab.content,
        editorId: tab.editorId,
        contentVersion,
        uri: tab.uri,
        filePath: tab.filePath,
        fileVersion: tab.fileVersion,
        pane: tab.pane === 'right' ? 'right' : 'main',
      });
    };

    const markTabSaveFailed = (tabId: string, path: string) => {
      set((state) => {
        let changed = false;
        const documents = getOpenDocuments(state).map((tab) => {
          if (
            tab.id !== tabId || !tab.isDirty || tab.saveFailed
            || (tab.filePath && !matchesDocumentTab(tab, path, undefined))
          ) {
            return tab;
          }
          changed = true;
          return { ...tab, saveFailed: true };
        });
        return changed ? patchDocumentsWithPinnedState(state, documents) : state;
      });
    };

    const notifySaveFailure = (tabId: string, message: string) => window.dispatchEvent(new CustomEvent('hulala:notice', {
      detail: { message, actionLabel: 'Save a copy…', action: () => get().saveFile({ tabId, saveAs: true }) },
    }));

    // Serialize saves from this page. Each write uses this document's read
    // version, and advances it before a later local save is allowed to run.
    const documentWrites = new Map<string, Promise<unknown>>();
    const writeDocument = (tabId: string, path: string, content: string) => {
      const previous = documentWrites.get(path) ?? Promise.resolve();
      const write = previous.catch(() => undefined).then(async () => {
        const tab = getOpenDocuments(get()).find(item => item.id === tabId);
        const expectedVersion = tab?.filePath === path ? tab.fileVersion ?? null : null;
        const result = await fileService.writeFile(path, content, { expectedVersion, create: true, overwrite: true, atomic: true });
        if (!result.error) set(state => patchDocumentsWithPinnedState(state, getOpenDocuments(state).map(item => item.id === tabId ? { ...item, fileVersion: result.version, saveFailed: false } : item)));
        return result;
      });
      documentWrites.set(path, write);
      void write.finally(() => { if (documentWrites.get(path) === write) documentWrites.delete(path); }).catch(() => undefined);
      return write;
    };

    const scheduleAutoSave = (
      path: string | null | undefined,
      uri: CanonicalFileURI | null | undefined,
      content: string,
      delayMs = AUTO_SAVE_DELAY_MS,
    ) => {
      if (!path) {
        return;
      }

      // Debounce per file path: keep pushing out while user edits.
      discardAutoSave(path);

      const handle = setTimeout(async () => {
        autoSaveTimers.delete(path);

        const retryIfCurrent = () => {
          const retryState = get();
          const retryTab = getOpenDocuments(retryState).find((tab) =>
            matchesDocumentTab(tab, path, uri),
          );
          if (
            retryTab?.isDirty
            && retryTab.content === content
            && retryTab.filePath
          ) {
            scheduleAutoSave(
              retryTab.filePath,
              retryTab.uri || uri,
              retryTab.content,
              AUTO_SAVE_RETRY_DELAY_MS,
            );
          }
        };

        const state = get();
        if (state.connectionState !== 'connected') {
          retryIfCurrent();
          return;
        }

        const tab = getOpenDocuments(state).find((item) =>
          matchesDocumentTab(item, path, uri) && item.content === content,
        );
        if (!tab || !tab.isDirty || tab.recoveredFromBackup || tab.saveFailed) {
          return;
        }

        // Ignore stale timers (a newer edit should have rescheduled).
        if (tab.content !== content) {
          return;
        }

        try {
          const result = await writeDocument(tab.id, path, content);

          if (result.error) {
            if (result.conflict) notifySaveFailure(tab.id, result.error);
            console.error('Failed to auto save file:', result.error);
            markTabSaveFailed(tab.id, path);
            if (!result.conflict) retryIfCurrent();
            return;
          }

          let savedCurrentContent = false;
          set((prev) => {
            const nextTabs = getOpenDocuments(prev).map((t) => {
              if (
                t.id === tab.id &&
                t.isDirty &&
                t.content === content
              ) {
                savedCurrentContent = true;
                return { ...t, isDirty: false, recoveredFromBackup: false };
              }
              return t;
            });

            const patch: Partial<AppState> = patchDocumentsWithPinnedState(
              prev,
              nextTabs,
            );
            if (
              uri &&
              prev.currentFileURI === uri &&
              prev.isDirty &&
              prev.fileContent === content
            ) {
              patch.isDirty = false;
            }
            return patch;
          });
          if (savedCurrentContent) {
            deleteRecoveryBackup(tab.id);
          } else {
            const current = getOpenDocuments(get()).find(item => item.id === tab.id);
            if (current?.isDirty) stageRecoveryBackup(current);
          }
        } catch (e) {
          console.error('Error auto saving file:', e);
          markTabSaveFailed(tab.id, path);
          retryIfCurrent();
        }
      }, delayMs);

      autoSaveTimers.set(path, handle);
    };

    const watchDirectory = async (dir: string) => {
      if (!dir) {
        return;
      }
      if (get().connectionState !== 'connected') {
        return;
      }
      if (get().dirWatchIds.has(dir)) {
        return;
      }
      const result = await fileService.watch(dir, false);
      if (result.error || !result.watchId) {
        if (result.error && result.error !== 'Not connected') {
          console.error('Failed to watch directory:', dir, result.error);
        }
        return;
      }
      set((state) => {
        const next = new Map(state.dirWatchIds);
        next.set(dir, result.watchId!);
        return { dirWatchIds: next };
      });
    };

    const unwatchDirectory = async (dir: string) => {
      const watchId = get().dirWatchIds.get(dir);
      if (!watchId) {
        return;
      }
      try {
        await fileService.unwatch(watchId);
      } catch {
        // ignore
      }
      set((state) => {
        const next = new Map(state.dirWatchIds);
        next.delete(dir);
        return { dirWatchIds: next };
      });
    };

    const clearAllWatches = async () => {
      const watchIds = Array.from(get().dirWatchIds.values());
      if (watchIds.length === 0) {
        return;
      }
      await Promise.all(
        watchIds.map(async (id) => {
          try {
            await fileService.unwatch(id);
          } catch {
            // ignore
          }
        }),
      );
      set({ dirWatchIds: new Map() });
    };

    const getOpenFileWatchDirs = (
      state: Pick<AppState, 'documents'>,
    ): string[] =>
      uniqueDirs(
        getOpenDocuments(state).map((tab) => {
          const path = normalizePosixPath((tab.filePath || '').trim());
          if (!path) {
            return null;
          }
          const slash = path.lastIndexOf('/');
          if (slash <= 0) {
            return null;
          }
          return path.slice(0, slash);
        }),
      );

    const getDesiredWatchDirs = (
      state: Pick<AppState, 'currentDir' | 'expandedDirs' | 'documents'>,
    ): string[] =>
      uniqueDirs([
        state.currentDir,
        ...Array.from(state.expandedDirs),
        ...getOpenFileWatchDirs(state),
      ]);

    const reloadOpenTabsByPaths = async (
      paths: string[],
      options?: { skipDirty?: boolean },
    ) => {
      if (get().connectionState !== 'connected') {
        return;
      }

      const pathSet = new Set(
        paths
          .map((path) => normalizePosixPath((path || '').trim()))
          .filter(Boolean),
      );
      if (pathSet.size === 0) {
        return;
      }

      const skipDirty = options?.skipDirty === true;
      const snapshot = get();
      const tabsToReload = getOpenDocuments(snapshot).filter((tab) => {
        const path = normalizePosixPath((tab.filePath || '').trim());
        if (!path || !pathSet.has(path)) {
          return false;
        }
        if (skipDirty && tab.isDirty) {
          return false;
        }
        return true;
      });
      if (tabsToReload.length === 0) {
        return;
      }

      const uniquePaths = Array.from(
        new Set(
          tabsToReload
            .map((tab) => normalizePosixPath(tab.filePath || ''))
            .filter(Boolean),
        ),
      );
      const binaryPreviewPaths = new Set(
        tabsToReload
          .filter(isBinaryPreviewDocumentTab)
          .map((tab) => normalizePosixPath(tab.filePath || ''))
          .filter(Boolean),
      );
      const textPaths = uniquePaths.filter(
        (path) => !binaryPreviewPaths.has(path),
      );
      const results = await Promise.all(
        textPaths.map(async (path) => ({
          path,
          result: await fileService.readFile(path),
        })),
      );
      const resultByPath = new Map(
        results.map((item) => [item.path, item.result]),
      );
      const binaryPreviewResults = await Promise.all(
        Array.from(binaryPreviewPaths).map(async (path) => ({
          path,
          result: await fileService.stat(path),
        })),
      );
      const binaryPreviewResultByPath = new Map(
        binaryPreviewResults.map((item) => [item.path, item.result]),
      );

      set((state) => {
        let tabsChanged = false;
        const nextTabs = getOpenDocuments(state).map((tab) => {
          const path = normalizePosixPath((tab.filePath || '').trim());
          if (!path || !pathSet.has(path)) {
            return tab;
          }
          if (skipDirty && tab.isDirty) {
            return tab;
          }
          const observed = tabsToReload.find(item => item.id === tab.id);
          if (!observed || observed.content !== tab.content || observed.fileVersion !== tab.fileVersion) return tab;

          if (isBinaryPreviewDocumentTab(tab)) {
            const result = binaryPreviewResultByPath.get(path);
            if (!result) {
              return tab;
            }
            if (result.error) {
              if (/file not found/i.test(result.error)) {
                if (tab.missing && tab.isDirty === false) {
                  return tab;
                }
                tabsChanged = true;
                return { ...tab, isDirty: false, missing: true };
              }
              return tab;
            }

            tabsChanged = true;
            return {
              ...tab,
              isDirty: false,
              missing: false,
              resourceVersion: (tab.resourceVersion ?? 0) + 1,
            };
          }

          const result = resultByPath.get(path);
          if (!result) {
            return tab;
          }
          if (result.error) {
            if (/file not found/i.test(result.error)) {
              if (tab.missing) {
                return tab;
              }
              tabsChanged = true;
              return { ...tab, isDirty: false, missing: true };
            }
            return tab;
          }
          if (result.tooLarge) {
            return tab;
          }

          const nextContent = result.content || '';
          if (
            tab.content === nextContent &&
            tab.fileVersion === result.version &&
            tab.isDirty === false &&
            tab.missing !== true
          ) {
            return tab;
          }
          tabsChanged = true;
          return {
            ...tab,
            content: nextContent,
            fileVersion: result.version,
            isDirty: false,
            missing: false,
          };
        });

        if (!tabsChanged) {
          return {};
        }

        const activeTab = state.activeTabId
          ? nextTabs.find((tab) => tab.id === state.activeTabId) || null
          : null;
        if (!activeTab) {
          return patchDocumentsWithPinnedState(state, nextTabs);
        }
        return {
          ...patchDocumentsWithPinnedState(state, nextTabs),
          ...toActiveState(activeTab),
        };
      });
    };

    const persistTabContent = async (
      tabId: string,
      targetPath: string,
      content: string,
    ): Promise<boolean> => {
      const normalizedTargetPath = normalizePosixPath(
        (targetPath || '').trim(),
      );
      if (!normalizedTargetPath) {
        return false;
      }

      discardAutoSave(normalizedTargetPath);

      try {
        const result = await writeDocument(tabId, normalizedTargetPath, content);
        if (result.error) {
          notifySaveFailure(tabId, result.error);
          console.error('Failed to save file:', result.error);
          markTabSaveFailed(tabId, normalizedTargetPath);
          return false;
        }

        let savedCurrentContent = false;
        set((state) => {
          const nextTabs = getOpenDocuments(state).map((tab) => {
            if (tab.id !== tabId) {
              return tab;
            }

            const nextPath = normalizedTargetPath;
            const contentStillCurrent = tab.content === content;
            savedCurrentContent = contentStillCurrent;
            return {
              ...tab,
              uri: pathToDocumentURI(nextPath, state) || tab.uri,
              filePath: nextPath,
              title: getFileTitle(normalizedTargetPath),
              content: tab.content,
              isDirty: !contentStillCurrent,
              recoveredFromBackup: contentStillCurrent
                ? false
                : tab.recoveredFromBackup,
              missing: false,
            };
          });

          const activeTab =
            state.activeTabId === tabId
              ? nextTabs.find((tab) => tab.id === tabId) || null
              : null;
          if (!activeTab) {
            return patchDocumentsWithPinnedState(state, nextTabs);
          }
          return {
            ...patchDocumentsWithPinnedState(state, nextTabs),
            currentFileURI: activeTab.uri || null,
            currentFilePath: activeTab.filePath || null,
            fileContent: activeTab.content,
            isDirty: activeTab.isDirty,
            pendingScrollHeading: activeTab.pendingScrollHeading,
            pendingRevealTarget: activeTab.pendingRevealTarget || null,
            editorId: activeTab.editorId,
          };
        });

        if (savedCurrentContent) {
          deleteRecoveryBackup(tabId);
        } else {
          const currentTab = getOpenDocuments(get()).find((tab) => tab.id === tabId);
          if (currentTab?.isDirty) {
            stageRecoveryBackup(currentTab);
            if (currentTab.filePath) {
              scheduleAutoSave(
                currentTab.filePath,
                currentTab.uri || pathToDocumentURI(currentTab.filePath, get()),
                currentTab.content,
              );
            }
          }
        }

        void syncWatches();
        return true;
      } catch (error) {
        console.error('Error saving file:', error);
        markTabSaveFailed(tabId, normalizedTargetPath);
        return false;
      }
    };

    const syncWatches = async () => {
      if (get().connectionState !== 'connected') {
        return;
      }
      const { currentDir, expandedDirs, dirWatchIds } = get();
      const desired = new Set(
        getDesiredWatchDirs({
          currentDir,
          expandedDirs,
          documents: get().documents,
        }),
      );

      // Unwatch removed dirs.
      for (const dir of dirWatchIds.keys()) {
        if (!desired.has(dir)) {
          void unwatchDirectory(dir);
        }
      }

      // Watch new dirs.
      for (const dir of desired) {
        void watchDirectory(dir);
      }
    };

    const restoreVisibleTreeAfterConnect = async (
      derived: DerivedDirs | null,
    ) => {
      const state = get();
      const remoteIdentity = buildRemoteSessionIdentity(state.remoteSession);
      const snapshot =
        remoteIdentity && visibleTreeSnapshot?.remoteIdentity === remoteIdentity
          ? visibleTreeSnapshot
          : null;
      const pendingDir = normalizeDirPath(pendingEnsureDir || '') || null;
      const currentDir = normalizeDirPath(state.currentDir || '') || null;
      const snapshotCurrentDir =
        normalizeDirPath(snapshot?.currentDir || '') || null;

      const restoredCurrentDir =
        pendingDir ||
        (snapshotCurrentDir && isAbsoluteDirPath(snapshotCurrentDir)
          ? snapshotCurrentDir
          : null) ||
        (currentDir && isAbsoluteDirPath(currentDir) ? currentDir : null) ||
        derived?.workspaceDir ||
        currentDir;

      const restoredExpandedDirs = derived
        ? uniqueDirs(
            (snapshot?.expandedDirs ?? Array.from(state.expandedDirs)).filter(
              (dir) => {
                if (isPathInVisibleRoots(dir, derived)) {
                  return true;
                }
                if (
                  restoredCurrentDir &&
                  isPathInsideRoot(dir, restoredCurrentDir)
                ) {
                  return true;
                }
                return false;
              },
            ),
          )
        : uniqueDirs(snapshot?.expandedDirs ?? Array.from(state.expandedDirs));

      set((store) => ({
        currentDir: restoredCurrentDir,
        expandedDirs: new Set(restoredExpandedDirs),
        entries: restoredCurrentDir
          ? (store.dirEntries.get(restoredCurrentDir) ?? [])
          : [],
      }));

      if (pendingDir && restoredCurrentDir === pendingDir) {
        pendingEnsureDir = null;
        await get().ensureDirectory(restoredCurrentDir);
      } else {
        pendingEnsureDir = null;
        const dirsToReload = uniqueDirs([
          restoredCurrentDir,
          ...restoredExpandedDirs,
        ]);
        if (dirsToReload.length > 0) {
          await Promise.all(
            dirsToReload.map((dir) => get().loadDirectory(dir)),
          );
        }
      }

      void syncWatches();
    };

    const disposeStore = () => {
      pendingDirs.clear();
      pendingEnsureDir = null;

      if (fileChangeTimer) {
        clearTimeout(fileChangeTimer);
        fileChangeTimer = null;
      }

      for (const handle of autoSaveTimers.values()) {
        clearTimeout(handle);
      }
      autoSaveTimers.clear();

      for (const tab of getOpenDocuments(get()).filter((item) => item.isDirty)) {
        stageRecoveryBackup(tab);
      }
      void window.hulala?.backup?.flush?.().catch(() => undefined);
      backupVersions.clear();
      editorViewStates.clear({ persistent: false });

      void clearAllWatches();
      connection.dispose();
      clearVisibleTreeSnapshot();

      set((state) => ({
        connectionState: 'disconnected',
        remoteSession: null,
        remoteConnecting: false,
        remoteError: null,
        baseDir: null,
        workspaceRootDir: null,
        instanceID: null,
        currentDir: null,
        entries: [],
        dirEntries: new Map(),
        dirLoading: new Set(),
        dirErrors: new Map(),
        dirWatchIds: new Map(),
        expandedDirs: new Set(),
        requestRootAction: null,
        sidebarSearchQuery: '',
        sidebarSearchIncludes: '',
        sidebarSearchExcludes: '',
        sidebarSearchFlags: {
          matchCase: false,
          wholeWord: false,
          regex: false,
        },
        sidebarSearchLoading: false,
        sidebarSearchError: null,
        sidebarSearchResults: [],
        sidebarSearchTotalCount: 0,
        sidebarSearchTruncated: false,
        sidebarSearchRequestSeq: 0,
        gitInfo: createEmptyGitInfo(),
        currentFileURI: null,
        currentFilePath: null,
        fileContent: '',
        isDirty: false,
        pendingScrollHeading: null,
        pendingRevealTarget: null,
        pendingBookTarget: null,
        editorId: null,
        editorFocused: false,
        editorBlurRequestSeq: 0,
        editorFocusRequest: null,
        documents: [],
        activeTabId: undefined,
        mainActiveTabId: undefined,
        rightActiveTabId: undefined,
        focusedEditorPane: 'main',
        rightPaneOpen: false,
        rightPaneActiveTabKey: undefined,
        outlineTabOpen: false,
        activityPanelPinnedRight: false,
        pendingDirtyTabClose: null,
      }));
    };

    return {
      // Initial state
      connectionState: 'disconnected',
      serverUrl: localRuntimeServerUrl,
      remoteSession: null,
      remoteConnecting: false,
      remoteError: null,
      baseDir: null,
      workspaceRootDir: null,
      instanceID: null,
      currentDir: null,
      entries: [],
      dirEntries: new Map<string, FileEntry[]>(),
      dirLoading: new Set<string>(),
      dirErrors: new Map<string, string>(),
      dirWatchIds: new Map<string, string>(),
      expandedDirs: new Set<string>(),
      requestRootAction: null as 'new-file' | 'new-folder' | null,
      sidebarSearchQuery: '',
      sidebarSearchIncludes: '',
      sidebarSearchExcludes: '',
      sidebarSearchFlags: { matchCase: false, wholeWord: false, regex: false },
      sidebarSearchLoading: false,
      sidebarSearchError: null,
      sidebarSearchResults: [],
      sidebarSearchTotalCount: 0,
      sidebarSearchTruncated: false,
      sidebarSearchRequestSeq: 0,
      gitInfo: createEmptyGitInfo(),
      currentFileURI: null,
      currentFilePath: null,
      fileContent: '',
      isDirty: false,
      pendingScrollHeading: null,
      pendingRevealTarget: null,
      pendingBookTarget: null,
      editorId: null,
      editorFocused: false,
      editorBlurRequestSeq: 0,
      editorFocusRequest: null,
      documents: [],
      activeTabId: undefined,
      mainActiveTabId: undefined,
      rightActiveTabId: undefined,
      focusedEditorPane: 'main',
      rightPaneOpen: false,
      rightPaneActiveTabKey: undefined,
      outlineTabOpen: false,
      activityPanelPinnedRight: false,
      pendingDirtyTabClose: null,

      // Actions
      connect: () => {
        const { serverUrl } = get();
        if (!serverUrl) {
          set({ connectionState: 'disconnected' });
          return;
        }
        void connection.connect(buildConnectionCallbacks()).catch(() => undefined);
      },

      setServerUrl: (url: string) => {
        set({ serverUrl: url });
      },

      setRemoteSession: (session: RemoteSessionInfo | null) => {
        if (session) {
          const state = get();
          const previousRemoteSession = get().remoteSession;
          const cachedDerived = getCachedDerivedDirsByServerUrl(`remote:${session.instanceId}`);
          const existingCurrentDir = state.currentDir;
          const nextIdentity = buildRemoteSessionIdentity(session);
          const previousIdentity = buildRemoteSessionIdentity(
            previousRemoteSession,
          );
          const keepVisibleTree =
            !!nextIdentity && nextIdentity === previousIdentity;
          void clearAllWatches();
          if (!keepVisibleTree) {
            clearVisibleTreeSnapshot();
          }
          set({
            remoteSession: session,
            serverUrl: `remote:${session.instanceId}`,
            baseDir: cachedDerived?.baseDir || null,
            workspaceRootDir: cachedDerived?.workspaceDir || null,
            instanceID: cachedDerived?.instanceID || null,
            currentDir: keepVisibleTree
              ? existingCurrentDir ||
                cachedDerived?.workspaceDir ||
                session.workspaceDir ||
                null
              : cachedDerived?.workspaceDir || session.workspaceDir || null,
            entries: keepVisibleTree ? state.entries : [],
            dirEntries: keepVisibleTree ? new Map(state.dirEntries) : new Map(),
            dirLoading: new Set(),
            dirErrors: keepVisibleTree ? new Map(state.dirErrors) : new Map(),
            dirWatchIds: new Map(),
            expandedDirs: keepVisibleTree
              ? new Set(state.expandedDirs)
              : new Set(),
            sidebarSearchLoading: false,
            sidebarSearchError: null,
            sidebarSearchResults: [],
            sidebarSearchTotalCount: 0,
            sidebarSearchTruncated: false,
            sidebarSearchRequestSeq: 0,
          });
        } else {
          void clearAllWatches();
          clearVisibleTreeSnapshot();
          set(() => ({
            remoteSession: null,
            serverUrl: localRuntimeServerUrl,
            baseDir: null,
            workspaceRootDir: null,
            instanceID: null,
            currentDir: null,
            entries: [],
            dirEntries: new Map(),
            dirLoading: new Set(),
            dirErrors: new Map(),
            dirWatchIds: new Map(),
            expandedDirs: new Set(),
            sidebarSearchLoading: false,
            sidebarSearchError: null,
            sidebarSearchResults: [],
            sidebarSearchTotalCount: 0,
            sidebarSearchTruncated: false,
            sidebarSearchRequestSeq: 0,
          }));
        }
      },

      setRemoteConnecting: (next: boolean) => {
        set({ remoteConnecting: next });
      },

      setRemoteError: (next: string | null) => {
        set({ remoteError: next });
      },

      disconnect: () => {
        void clearAllWatches();
        connection.disconnect();
      },

      reconnectNow: () => {
        const { serverUrl } = get();
        if (!serverUrl) {
          set({ connectionState: 'disconnected' });
          return;
        }
        void connection.connect(buildConnectionCallbacks()).catch(() => undefined);
      },

      suspend: () => {
        void clearAllWatches();
        connection.suspend();
      },

      resume: () => {
        connection.resume();
      },

      dispose: () => {
        disposeStore();
      },

      setActive: (active: boolean) => {
        if (active) {
          // Reconnect if needed (e.g. connection was lost while inactive)
          if (get().connectionState !== 'connected') {
            get().reconnectNow();
          }
          const { currentDir, dirEntries } = get();
          if (currentDir) {
            const entries = dirEntries.get(currentDir);
            if (!entries || entries.length === 0) {
              get().loadDirectory(currentDir);
            }
          }
          void syncWatches();
        } else {
          // When window loses focus, only pause file change processing
          // but keep the WebSocket connection alive
          pendingDirs.clear();
          if (fileChangeTimer) {
            clearTimeout(fileChangeTimer);
            fileChangeTimer = null;
          }
          // Don't call connection.suspend() - keep WebSocket connected
          // Just clear watches to reduce server load
          void clearAllWatches();
        }
      },

      setCurrentDir: (dir: string) => {
        void clearAllWatches();
        set(() => ({
          currentDir: dir,
          entries: [],
          dirEntries: new Map(),
          dirLoading: new Set(),
          dirErrors: new Map(),
          dirWatchIds: new Map(),
          expandedDirs: new Set(),
          gitInfo: createEmptyGitInfo(),
        }));
        if (get().connectionState === 'connected') {
          void syncWatches();
          void get().refreshGitInfo(dir);
          get().loadDirectory(dir);
        }
      },

      setRequestRootAction: (action: 'new-file' | 'new-folder' | null) => {
        set({ requestRootAction: action });
      },

      setSidebarSearchQuery: (value: string) => {
        set({ sidebarSearchQuery: value });
      },

      setSidebarSearchIncludes: (value: string) => {
        set({ sidebarSearchIncludes: value });
      },

      setSidebarSearchExcludes: (value: string) => {
        set({ sidebarSearchExcludes: value });
      },

      setSidebarSearchFlag: (
        flag: keyof SidebarSearchFlags,
        value: boolean,
      ) => {
        set((state) => ({
          sidebarSearchFlags: {
            ...state.sidebarSearchFlags,
            [flag]: value,
          },
        }));
      },

      clearSidebarSearchState: () => {
        set({
          sidebarSearchLoading: false,
          sidebarSearchError: null,
          sidebarSearchResults: [],
          sidebarSearchTotalCount: 0,
          sidebarSearchTruncated: false,
        });
      },

      runSidebarSearch: async (options?: { installRetry?: boolean }) => {
        const state = get();
        const root = normalizeDirPath(state.currentDir || '');
        const query = state.sidebarSearchQuery.trim();
        if (!root || state.connectionState !== 'connected') {
          set({
            sidebarSearchLoading: false,
            sidebarSearchError:
              state.connectionState === 'connected' ? null : 'Not connected',
            sidebarSearchResults: [],
            sidebarSearchTotalCount: 0,
            sidebarSearchTruncated: false,
          });
          return;
        }
        if (!query) {
          set({
            sidebarSearchLoading: false,
            sidebarSearchError: null,
            sidebarSearchResults: [],
            sidebarSearchTotalCount: 0,
            sidebarSearchTruncated: false,
          });
          return;
        }

        const requestSeq = state.sidebarSearchRequestSeq + 1;
        set({
          sidebarSearchLoading: true,
          sidebarSearchError: null,
          sidebarSearchRequestSeq: requestSeq,
        });

        const result = await fileService.search({
          root,
          query,
          regex: state.sidebarSearchFlags.regex,
          matchCase: state.sidebarSearchFlags.matchCase,
          wholeWord: state.sidebarSearchFlags.wholeWord,
          includes: parseSidebarSearchGlobs(state.sidebarSearchIncludes),
          excludes: parseSidebarSearchGlobs(state.sidebarSearchExcludes),
        });

        if (get().sidebarSearchRequestSeq !== requestSeq) {
          return;
        }

        if (result.error) {
          set({
            sidebarSearchLoading: false,
            sidebarSearchError: result.error,
            sidebarSearchResults: [],
            sidebarSearchTotalCount: 0,
            sidebarSearchTruncated: false,
          });
          return;
        }

        set({
          sidebarSearchLoading: false,
          sidebarSearchError: null,
          sidebarSearchResults: result.files || [],
          sidebarSearchTotalCount: result.totalCount || 0,
          sidebarSearchTruncated: result.truncated === true,
        });
      },

      refreshGitInfo: async (path?: string) => {
        const targetDir = normalizeDirPath(path || get().currentDir || '');
        if (!targetDir || get().connectionState !== 'connected') {
          set({ gitInfo: createEmptyGitInfo() });
          return;
        }

        const requestSeq = ++gitInfoRequestSeq;
        set((state) => ({
          gitInfo: {
            ...state.gitInfo,
            status: 'loading',
            error: null,
            loadedPath: targetDir,
          },
        }));

        const result = await gitService.getBranches(targetDir);
        if (requestSeq !== gitInfoRequestSeq) {
          return;
        }

        if (result.error) {
          console.warn('[git] failed to load branches:', result.error);
          set({
            gitInfo: {
              ...createEmptyGitInfo(),
              status: 'ready',
              error: result.error,
              loadedPath: targetDir,
            },
          });
          return;
        }

        if (!result.isRepo) {
          set({
            gitInfo: {
              ...createEmptyGitInfo(),
              status: 'ready',
              loadedPath: targetDir,
            },
          });
          return;
        }

        set({
          gitInfo: {
            status: 'ready',
            error: null,
            isRepo: true,
            repoRoot: result.repoRoot || null,
            currentBranch: result.currentBranch || null,
            detached: result.detached === true,
            detachedLabel: result.detachedLabel || null,
            branches: result.branches || [],
            dirty: result.dirty || { ...EMPTY_GIT_DIRTY },
            loadedPath: targetDir,
          },
        });
      },

      listCronTasks: async () => {
        if (get().connectionState !== 'connected') {
          return [];
        }
        return cronService.list();
      },

      getCronTask: async (id: string) => {
        if (!id || get().connectionState !== 'connected') {
          return null;
        }
        return cronService.get(id);
      },

      updateCronTask: async (task: CronTask) => {
        if (!task?.id || get().connectionState !== 'connected') {
          throw new Error('Cron requires an active runtime connection.');
        }
        const result = await cronService.update(task);
        if (!result?.task) {
          throw new Error('Cron update returned no task.');
        }
        const title = result.task.name?.trim();
        if (result.task.id && title) {
          get().openCronTaskTab(result.task.id, title);
        }
        return result;
      },

      runCronTask: async (id: string) => {
        if (!id || get().connectionState !== 'connected') {
          throw new Error('Cron requires an active runtime connection.');
        }
        return cronService.run(id);
      },

      listCronTaskHistory: async (id: string, limit = CRON_TASK_HISTORY_LIMIT) => {
        if (!id || get().connectionState !== 'connected') {
          return [];
        }
        return cronService.history(id, limit);
      },

      ensureDirectory: async (dir: string) => {
        if (!dir) {
          return;
        }
        if (get().connectionState !== 'connected') {
          pendingEnsureDir = dir;
          return;
        }
        try {
          void watchDirectory(dir);
          const result = await fileService.mkdir(dir, true);
          if (result.error && result.error !== 'Not connected') {
            console.error('Failed to ensure directory:', result.error);
          }
        } catch (e) {
          console.error('Error ensuring directory:', e);
        }
        await get().loadDirectory(dir);
      },

      loadDirectory: async (dir: string) => {
        if (get().connectionState !== 'connected') {
          return;
        }
        const hadSnapshot = get().dirEntries.has(dir);
        set((state) => {
          const nextLoading = new Set(state.dirLoading);
          const nextErrors = new Map(state.dirErrors);
          if (!state.dirEntries.has(dir)) {
            nextLoading.add(dir);
          } else {
            nextLoading.delete(dir);
          }
          nextErrors.delete(dir);
          return { dirLoading: nextLoading, dirErrors: nextErrors };
        });
        try {
          const result = await fileService.readdir(dir);
          if (result.error) {
            if (result.error !== 'Not connected') {
              console.error('Failed to load directory:', result.error);
            }
            set((state) => {
              const nextMap = new Map(state.dirEntries);
              const nextLoading = new Set(state.dirLoading);
              const nextErrors = new Map(state.dirErrors);
              const message = result.error || 'Failed to load directory';
              nextLoading.delete(dir);
              if (state.dirEntries.has(dir) && isTransientDirectoryLoadError(message)) {
                nextErrors.delete(dir);
              } else {
                nextMap.set(dir, []);
                nextErrors.set(dir, message);
              }
              const patch: Partial<AppState> = {
                dirEntries: nextMap,
                dirLoading: nextLoading,
                dirErrors: nextErrors,
              };
              if (dir === state.currentDir && (!state.dirEntries.has(dir) || !isTransientDirectoryLoadError(message))) {
                patch.entries = [];
              }
              return patch;
            });
            return;
          }

          const entries = result.entries || [];
          set((state) => {
            const nextMap = new Map(state.dirEntries);
            const nextLoading = new Set(state.dirLoading);
            const nextErrors = new Map(state.dirErrors);
            nextMap.set(dir, entries);
            nextLoading.delete(dir);
            nextErrors.delete(dir);
            const patch: Partial<AppState> = {
              dirEntries: nextMap,
              dirLoading: nextLoading,
              dirErrors: nextErrors,
            };
            if (dir === state.currentDir) {
              patch.entries = entries;
            }
            return patch;
          });

        } catch (e) {
          console.error('Error loading directory:', e);
          set((state) => {
            const nextMap = new Map(state.dirEntries);
            const nextLoading = new Set(state.dirLoading);
            const nextErrors = new Map(state.dirErrors);
            const message =
              e instanceof Error ? e.message : 'Failed to load directory';
            nextLoading.delete(dir);
            if ((state.dirEntries.has(dir) || hadSnapshot) && isTransientDirectoryLoadError(message)) {
              nextErrors.delete(dir);
            } else {
              nextMap.set(dir, []);
              nextErrors.set(dir, message);
            }
            const patch: Partial<AppState> = {
              dirEntries: nextMap,
              dirLoading: nextLoading,
              dirErrors: nextErrors,
            };
            if (dir === state.currentDir && ((!state.dirEntries.has(dir) && !hadSnapshot) || !isTransientDirectoryLoadError(message))) {
              patch.entries = [];
            }
            return patch;
          });
        }
      },

      readDirectory: async (dir: string) => {
        try {
          await get().loadDirectory(dir);
          return get().dirEntries.get(dir) ?? EMPTY_ENTRIES;
        } catch {
          return EMPTY_ENTRIES;
        }
      },

      listDirectory: async (dir: string) => {
        if (get().connectionState !== 'connected') {
          return { error: 'Not connected' };
        }
        return fileService.readdir(dir);
      },

      statPath: async (path: string) => {
        if (get().connectionState !== 'connected') {
          return { error: 'Not connected' } as StatResult & { error: string };
        }
        return fileService.stat(path);
      },

      toggleDir: (dir: string) => {
        const { expandedDirs } = get();
        const newExpanded = new Set(expandedDirs);

        if (newExpanded.has(dir)) {
          newExpanded.delete(dir);
        } else {
          newExpanded.add(dir);
          get().loadDirectory(dir);
        }

        set({ expandedDirs: newExpanded });
        if (get().connectionState === 'connected') {
          void syncWatches();
        }
      },

      openFile: async (
        path: string,
        options?: {
          fresh?: boolean;
          heading?: string;
          reveal?: EditorRevealTarget;
          bookTarget?: BookOpenTarget;
          focusEditor?: boolean;
          pane?: EditorPane;
        },
      ) => {
        const { isDirty, currentFilePath, currentFileURI } = get();
        if (isDirty && currentFilePath) {
          console.warn('Unsaved changes in', currentFilePath);
        }

        try {
          const nextURI = pathToDocumentURI(path, get());
          const existing = !options?.fresh && get().documents.find((tab) =>
            matchesDocumentTab(tab, path, nextURI),
          );
          if (existing) {
            const pendingScrollHeading = options?.heading || null;
            const pendingRevealTarget = options?.reveal || null;
            const pendingBookTarget = options?.bookTarget || null;
            set((state) => {
              const nextDocuments = state.documents.map((tab) =>
                tab.id === existing.id
                  ? {
                      ...tab,
                      ...(options?.pane ? { pane: options.pane } : {}),
                      pendingScrollHeading,
                      pendingRevealTarget,
                      pendingBookTarget,
                    }
                  : tab,
              );
              const nextActive = nextDocuments.find(
                (tab) => tab.id === existing.id,
              );
              if (!nextActive) {
                return {};
              }
              return {
                ...patchDocumentsWithPinnedState(state, nextDocuments),
                activeTabId: existing.id,
                ...(nextActive.pane === 'right'
                  ? {
                      rightActiveTabId: existing.id,
                      focusedEditorPane: 'right' as const,
                      rightPaneOpen: true,
                      rightPaneActiveTabKey: `file:${existing.id}` as const,
                    }
                  : {
                      mainActiveTabId: existing.id,
                      focusedEditorPane: 'main' as const,
                    }),
                ...toActiveState(nextActive),
                editorFocusRequest: nextEditorFocusRequest(
                  state,
                  existing.id,
                  options?.focusEditor === true,
                ),
              };
            });
            if (options?.pane === 'right' || existing.pane === 'right') {
              registerRightWorkspaceFile(existing.id);
            }
            return;
          }

          const settings = await window.hulala?.settings.get();
          const { editorRegistry } = await import('../services/editorRegistry');
          const editorId = editorRegistry.resolveEditorId(
            path,
            settings?.editor?.workbenchEditorAssociations || {},
          );

          const openableExtensions = settings?.editor?.openableExtensions || [];
          if (!isFileExtensionOpenable(path, openableExtensions)) {
            console.warn(
              'File extension not in openable list:',
              getNormalizedFileExtension(path),
            );
            return;
          }

          let nextContent = '';
          let fileVersion: string | undefined;
          const isBinaryPreview =
            editorId === 'image' || editorId === 'pdf' || editorId === 'book' || editorId === 'word';
          if (!isBinaryPreview) {
            const result = await fileService.readFile(path);
            if (result.error) {
              console.error('Failed to read file:', result.error);
              return;
            }

            if (result.tooLarge) {
              console.warn('File too large to open');
              return;
            }

            nextContent = result.content || '';
            fileVersion = result.version;
          }

          // Click and double-click can both finish an asynchronous remote read.
          // Reuse the winner, including any edits made since that read started.
          if (!options?.fresh && get().documents.some(tab => matchesDocumentTab(tab, path, pathToDocumentURI(path, get())))) {
            await get().openFile(path, options);
            return;
          }
          const nextTab: DocumentTab = normalizeDocumentTab({
            id: createId('tab'),
            title: getFileTitle(path),
            uri: nextURI || undefined,
            filePath: path,
            editorId,
            content: nextContent,
            fileVersion,
            isDirty: false,
            resourceVersion: isBinaryPreview ? 0 : undefined,
            pendingScrollHeading: options?.heading || null,
            pendingRevealTarget: options?.reveal || null,
            pendingBookTarget: options?.bookTarget || null,
            pane: options?.pane,
          });
          set((state) => {
            // Auto-close Welcome tab when opening other tabs
            const filteredTabs = state.documents.filter(
              (tab) => tab.editorId !== 'welcome',
            );
            const nextTabs = [...filteredTabs, nextTab];
            if (nextTab.pane === 'right') {
              return {
                ...patchDocumentsWithPinnedState(state, nextTabs),
                activeTabId: nextTab.id,
                rightActiveTabId: nextTab.id,
                focusedEditorPane: 'right',
                rightPaneOpen: true,
                rightPaneActiveTabKey: `file:${nextTab.id}` as const,
                ...toActiveState(nextTab),
                editorFocusRequest: nextEditorFocusRequest(
                  state,
                  nextTab.id,
                  options?.focusEditor === true,
                ),
              };
            }
            return {
              ...patchDocumentsWithPinnedState(state, nextTabs),
              activeTabId: nextTab.id,
              mainActiveTabId: nextTab.id,
              focusedEditorPane: 'main',
              ...toActiveState(nextTab),
              editorFocusRequest: nextEditorFocusRequest(
                state,
                nextTab.id,
                options?.focusEditor === true,
              ),
            };
          });
          if (nextTab.pane === 'right') {
            registerRightWorkspaceFile(nextTab.id);
          }
          void syncWatches();
        } catch (e) {
          console.error('Error opening file:', e);
        }
      },

      openCommandsTab: () => {
        set((state) => {
          const result = upsertSingletonEditorTab(getOpenDocuments(state), 'commands', () => ({
            id: createId('tab'), title: 'Commands', editorId: 'commands', content: '', isDirty: false, pendingScrollHeading: null,
          }), { removeWelcome: true });
          return {
            ...patchDocumentsWithPinnedState(state, result.tabs), activeTabId: result.tab.id,
            mainActiveTabId: result.tab.id, focusedEditorPane: 'main', ...toActiveState(result.tab),
          };
        });
      },

      openWelcomeTab: () => {
        set((state) => {
          const existing = state.documents.find(
            (tab) => tab.editorId === 'welcome',
          );
          const tab: DocumentTab = existing || {
            id: createId('tab'),
            title: rendererI18n.t('shell:tab.welcome'),
            editorId: 'welcome',
            content: '',
            isDirty: false,
            pendingScrollHeading: null,
          };
          const nextTabs = existing
            ? state.documents
            : [tab, ...state.documents];
          return {
            ...patchDocumentsWithPinnedState(state, nextTabs),
            activeTabId: tab.id,
            mainActiveTabId: tab.id,
            focusedEditorPane: 'main',
            ...toActiveState(tab),
          };
        });
      },

      openCronTaskTab: (id: string, title?: string) => {
        const taskID = (id || '').trim();
        if (!taskID) {
          return;
        }
        const editorId = `cron-task:${taskID}`;
        const tabTitle = (title || '').trim() || 'Cron Task';
        set((state) => {
          const result = upsertSingletonEditorTab(
            getOpenDocuments(state),
            editorId,
            () => ({
              id: createId('tab'),
              title: tabTitle,
              editorId,
              content: '',
              isDirty: false,
              pendingScrollHeading: null,
            }),
            { removeWelcome: true },
          );
          if (result.existed) {
            const nextDocuments = state.documents.map((tab) =>
              tab.id === result.tab.id && tab.title !== tabTitle
                ? { ...tab, title: tabTitle }
                : tab,
            );
            const nextTab = nextDocuments.find((tab) => tab.id === result.tab.id) || result.tab;
            return {
              ...patchDocumentsWithPinnedState(state, nextDocuments),
              activeTabId: nextTab.id,
              mainActiveTabId: nextTab.id,
              focusedEditorPane: 'main',
              ...toActiveState(nextTab),
            };
          }
          return {
            ...patchDocumentsWithPinnedState(state, result.tabs),
            activeTabId: result.tab.id,
            mainActiveTabId: result.tab.id,
            focusedEditorPane: 'main',
            ...toActiveState(result.tab),
          };
        });
      },

      openPluginTab: (id: string, title?: string) => {
        const taskID = (id || '').trim();
        if (!taskID) {
          return;
        }
        const editorId = `plugin:${taskID}`;
        const tabTitle = (title || '').trim() || 'Plugin';
        set((state) => {
          const result = upsertSingletonEditorTab(
            getOpenDocuments(state),
            editorId,
            () => ({
              id: createId('tab'),
              title: tabTitle,
              editorId,
              content: '',
              isDirty: false,
              pendingScrollHeading: null,
            }),
            { removeWelcome: true },
          );
          if (result.existed) {
            const nextDocuments = state.documents.map((tab) =>
              tab.id === result.tab.id && tab.title !== tabTitle
                ? { ...tab, title: tabTitle }
                : tab,
            );
            const nextTab = nextDocuments.find((tab) => tab.id === result.tab.id) || result.tab;
            return {
              ...patchDocumentsWithPinnedState(state, nextDocuments),
              activeTabId: nextTab.id,
              mainActiveTabId: nextTab.id,
              focusedEditorPane: 'main',
              ...toActiveState(nextTab),
            };
          }
          return {
            ...patchDocumentsWithPinnedState(state, result.tabs),
            activeTabId: result.tab.id,
            mainActiveTabId: result.tab.id,
            focusedEditorPane: 'main',
            ...toActiveState(result.tab),
          };
        });
      },

      openUntitledTab: () => {
        set((state) => {
          const tab: DocumentTab = {
            id: createId('tab'),
            title: NEW_TAB_TITLE,
            editorId: 'markdown',
            content: '',
            isDirty: false,
            pendingScrollHeading: null,
          };
          // Auto-close Welcome tab when opening other tabs
          const filteredTabs = state.documents.filter(
            (t) => t.editorId !== 'welcome',
          );
          const nextTabs = [...filteredTabs, tab];
          return {
            ...patchDocumentsWithPinnedState(state, nextTabs),
            activeTabId: tab.id,
            mainActiveTabId: tab.id,
            focusedEditorPane: 'main',
            ...toActiveState(tab),
            editorFocusRequest: nextEditorFocusRequest(state, tab.id, true),
          };
        });
      },

      retargetActiveBlankTab: (
        newPath: string,
        title?: string,
        content?: string,
      ) => {
        const to = (newPath || '').trim();
        if (!to) {
          return false;
        }
        const nextContent = typeof content === 'string' ? content : '';

        let retargeted = false;
        set((state) => {
          const toURI = pathToDocumentURI(to, state);
          const result = retargetActiveBlankNewTab(
            getOpenDocuments(state),
            state.activeTabId,
            (tab) => ({
              ...tab,
              uri: toURI || undefined,
              filePath: to,
              title: title || getFileTitle(to),
              content: nextContent,
              isDirty: false,
              missing: false,
            }),
          );
          retargeted = result.retargeted;
          if (!result.retargeted || !result.tab) {
            return {};
          }
          return {
            ...patchDocumentsWithPinnedState(state, result.tabs),
            activeTabId: result.tab.id,
            mainActiveTabId: result.tab.id,
            focusedEditorPane: 'main',
            ...toActiveState(result.tab),
          };
        });
        if (retargeted) {
          void syncWatches();
        }
        return retargeted;
      },

      retargetTabPath: (oldPath: string, newPath: string, title?: string) => {
        const from = (oldPath || '').trim();
        const to = (newPath || '').trim();
        if (!from || !to || from === to) {
          return;
        }
        get().retargetMovedTabs([{ oldPath: from, newPath: to }]);
        if (title) {
          set((state) => {
            const toURI = pathToDocumentURI(to, state);
            const target = getOpenDocuments(state).find((tab) =>
              matchesDocumentTab(tab, to, toURI),
            );
            if (!target || target.title === title) {
              return {};
            }
            const nextTabs = getOpenDocuments(state).map((tab) =>
              tab.id === target.id ? { ...tab, title } : tab,
            );
            const nextActive =
              state.activeTabId === target.id
                ? nextTabs.find((tab) => tab.id === target.id)
                : undefined;
            return nextActive
              ? {
                  ...patchDocumentsWithPinnedState(state, nextTabs),
                  ...toActiveState(nextActive),
                }
              : patchDocumentsWithPinnedState(state, nextTabs);
          });
        }
      },

      retargetMovedTabs: (ops) => {
        const normalizedOps = ops
          .map((op) => ({
            oldPath: (op.oldPath || '').trim(),
            newPath: (op.newPath || '').trim(),
          }))
          .filter(
            (op) => !!op.oldPath && !!op.newPath && op.oldPath !== op.newPath,
          )
          .sort((a, b) => b.oldPath.length - a.oldPath.length);

        if (normalizedOps.length === 0) {
          return;
        }

        set((state) => {
          let changed = false;
          const nextTabs = getOpenDocuments(state).map((tab) => {
            const nextPath = replaceMovedPath(tab.filePath, normalizedOps);
            if (!nextPath || nextPath === tab.filePath) {
              return tab;
            }
            changed = true;
            return {
              ...tab,
              uri: pathToDocumentURI(nextPath, state) || undefined,
              filePath: nextPath,
              title: getFileTitle(nextPath),
              missing: false,
            };
          });

          if (!changed) {
            return {};
          }

          const activeTab = state.activeTabId
            ? nextTabs.find((tab) => tab.id === state.activeTabId)
            : undefined;
          if (!activeTab) {
            return patchDocumentsWithPinnedState(state, nextTabs);
          }
          return {
            ...patchDocumentsWithPinnedState(state, nextTabs),
            ...toActiveState(activeTab),
          };
        });
        void syncWatches();
      },

      setActiveTab: (tabId: string, options?: { focusEditor?: boolean }) => {
        set((state) => {
          const nextTab = state.documents.find((tab) => tab.id === tabId);
          if (!nextTab) {
            return {};
          }
          const pane = nextTab.pane === 'right' ? 'right' : 'main';
          return {
            activeTabId: tabId,
            ...(pane === 'right'
              ? {
                  rightActiveTabId: tabId,
                  rightPaneOpen: true,
                  rightPaneActiveTabKey: `file:${tabId}` as const,
                }
              : { mainActiveTabId: tabId }),
            focusedEditorPane: pane,
            ...toActiveState(nextTab),
            editorFocusRequest: nextEditorFocusRequest(
              state,
              nextTab.id,
              options?.focusEditor === true,
            ),
          };
        });
      },

      moveTabToPane: (tabId, pane) => {
        const normalizedId = (tabId || '').trim();
        const snapshot = get();
        const target = snapshot.documents.find((tab) => tab.id === normalizedId);
        if (!target || !isMovableEditorTab(target)) {
          return false;
        }
        const sourcePane: EditorPane = target.pane === 'right' ? 'right' : 'main';
        if (sourcePane === pane) {
          get().setActiveTab(target.id, { focusEditor: true });
          return true;
        }
        set((state) => {
          const move = movePaneDocument(state.documents, normalizedId, pane);
          if (!move) {
            return {};
          }
          const nextDocuments = move.documents.map(normalizeDocumentTab);
          const nextTab = normalizeDocumentTab(move.moved);
          const sourceFallbackId = move.sourceFallbackId;
          const patch = patchDocumentsWithPaneState(state, nextDocuments);
          const mainActiveTabId = pane === 'main'
            ? normalizedId
            : sourcePane === 'main'
              ? sourceFallbackId
              : patch.mainActiveTabId;
          const rightActiveTabId = pane === 'right'
            ? normalizedId
            : sourcePane === 'right'
              ? sourceFallbackId
              : patch.rightActiveTabId;
          return {
            ...patch,
            activeTabId: normalizedId,
            mainActiveTabId,
            rightActiveTabId,
            focusedEditorPane: pane,
            rightPaneOpen: pane === 'right' ? true : state.rightPaneOpen,
            rightPaneActiveTabKey: pane === 'right'
              ? `file:${normalizedId}`
              : rightActiveTabId
                ? `file:${rightActiveTabId}`
                : state.outlineTabOpen
                  ? 'outline'
                  : state.activityPanelPinnedRight
                    ? 'activity'
                    : undefined,
            ...toActiveState(nextTab),
            editorFocusRequest: nextEditorFocusRequest(state, normalizedId, true),
          };
        });
        return true;
      },

      setFocusedEditorPane: (pane) => {
        const state = get();
        if (pane === 'right' && state.rightPaneActiveTabKey && !state.rightPaneActiveTabKey.startsWith('file:')) {
          set({ focusedEditorPane: 'right' });
          return;
        }
        const tabId = pane === 'right' ? state.rightActiveTabId : state.mainActiveTabId;
        if (tabId) {
          state.setActiveTab(tabId);
          return;
        }
        set({ focusedEditorPane: pane });
      },

      setRightPaneOpen: (open) => {
        set({ rightPaneOpen: open });
      },

      selectRightPaneTab: (key) => {
        if (key.startsWith('file:')) {
          const tabId = key.slice('file:'.length);
          const target = get().documents.find((tab) => tab.id === tabId && tab.pane === 'right');
          if (!target) return;
          get().setActiveTab(tabId, { focusEditor: true });
          return;
        }
        const state = get();
        if (key === 'outline' && !state.outlineTabOpen) return;
        if (key === 'activity' && !state.activityPanelPinnedRight) return;
        set({ rightPaneOpen: true, rightPaneActiveTabKey: key, focusedEditorPane: 'right' });
      },

      openOutlineInRightPane: () => {
        set({
          outlineTabOpen: true,
          rightPaneOpen: true,
          rightPaneActiveTabKey: 'outline',
          focusedEditorPane: 'right',
        });
      },

      closeOutlineInRightPane: () => {
        set((state) => {
          const nextKey: RightPaneTabKey | undefined = state.rightActiveTabId
            ? `file:${state.rightActiveTabId}`
            : state.activityPanelPinnedRight
              ? 'activity'
              : undefined;
          return {
            outlineTabOpen: false,
            rightPaneActiveTabKey: state.rightPaneActiveTabKey === 'outline'
              ? nextKey
              : state.rightPaneActiveTabKey,
            rightPaneOpen: state.rightPaneOpen,
          };
        });
      },

      setActivityPanelPinnedRight: (pinned) => {
        set((state) => {
          if (pinned) {
            return {
              activityPanelPinnedRight: true,
              rightPaneOpen: true,
              rightPaneActiveTabKey: 'activity' as const,
              focusedEditorPane: 'right' as const,
            };
          }
          const nextKey: RightPaneTabKey | undefined = state.rightActiveTabId
            ? `file:${state.rightActiveTabId}`
            : state.outlineTabOpen
              ? 'outline'
              : undefined;
          return {
            activityPanelPinnedRight: false,
            rightPaneActiveTabKey: state.rightPaneActiveTabKey === 'activity'
              ? nextKey
              : state.rightPaneActiveTabKey,
            rightPaneOpen: state.rightPaneOpen,
          };
        });
      },

      resetEditorPaneLayout: () => {
        set((state) => {
          const documents = state.documents.map((tab) => normalizeDocumentTab({ ...tab, pane: 'main' }));
          const activeTab = (state.activeTabId
            ? documents.find((tab) => tab.id === state.activeTabId)
            : undefined) || documents[0];
          return {
            documents,
            activeTabId: activeTab?.id,
            mainActiveTabId: activeTab?.id,
            rightActiveTabId: undefined,
            focusedEditorPane: 'main',
            rightPaneOpen: false,
            rightPaneActiveTabKey: undefined,
            outlineTabOpen: false,
            activityPanelPinnedRight: false,
            ...(activeTab ? toActiveState(activeTab) : {}),
          };
        });
      },

      activateLastPrimaryTab: (options) => {
        const state = get();
        const excludeTabId = (options?.excludeTabId || '').trim();
        const visibleTabs = getEditorDocuments(state.documents).filter(
          (tab) => {
            if (excludeTabId && tab.id === excludeTabId) {
              return false;
            }
            return true;
          },
        );
        const fallback =
          visibleTabs.length > 0 ? visibleTabs[visibleTabs.length - 1] : null;
        if (!fallback) {
          set({
            activeTabId: undefined,
            mainActiveTabId: undefined,
            currentFileURI: null,
            currentFilePath: null,
            fileContent: '',
            isDirty: false,
            pendingScrollHeading: null,
            pendingRevealTarget: null,
            pendingBookTarget: null,
            editorId: null,
          });
          return false;
        }
        set({
          activeTabId: fallback.id,
          mainActiveTabId: fallback.id,
          focusedEditorPane: 'main',
          ...toActiveState(fallback),
        });
        return true;
      },

      closeTab: (tabId: string, options?: { focusEditor?: boolean }) => {
        const state = get();
        const tab = getOpenDocuments(state).find((item) => item.id === tabId);
        if (!tab) {
          return;
        }
        if (tab.isDirty) {
          set({
            pendingDirtyTabClose: {
              tabId: tab.id,
              title: tab.title,
              focusEditor: options?.focusEditor === true,
            },
          });
          return;
        }
        closeTabNow(tabId, options?.focusEditor === true);
      },

      dismissPendingDirtyTabClose: () => {
        set({ pendingDirtyTabClose: null });
      },

      confirmPendingDirtyTabClose: () => {
        const pending = get().pendingDirtyTabClose;
        if (!pending) {
          return;
        }
        closeTabNow(pending.tabId, pending.focusEditor);
      },

      closeOtherTabs: (tabId: string, options?: { focusEditor?: boolean }) => {
        for (const tab of getOpenDocuments(get())) {
          if (tab.id !== tabId) {
            editorViewStates.forgetTab(tab.id);
            discardAutoSave(tab.filePath);
            deleteRecoveryBackup(tab.id);
          }
        }
        set((state) => {
          const keep = getOpenDocuments(state).find((tab) => tab.id === tabId);
          if (!keep) {
            return {};
          }
          return {
            ...patchDocumentsWithPinnedState(state, [keep]),
            activeTabId: keep.id,
            mainActiveTabId: keep.pane === 'right' ? undefined : keep.id,
            rightActiveTabId: keep.pane === 'right' ? keep.id : undefined,
            focusedEditorPane: keep.pane === 'right' ? 'right' : 'main',
            rightPaneOpen: state.rightPaneOpen,
            rightPaneActiveTabKey: keep.pane === 'right'
              ? `file:${keep.id}`
              : state.outlineTabOpen
                ? 'outline'
                : state.activityPanelPinnedRight
                  ? 'activity'
                  : undefined,
            pendingDirtyTabClose: null,
            ...toActiveState(keep),
            editorFocusRequest: nextEditorFocusRequest(
              state,
              keep.id,
              options?.focusEditor === true,
            ),
          };
        });
        void syncWatches();
      },

      closeAllTabs: () => {
        for (const tab of getOpenDocuments(get())) {
          editorViewStates.forgetTab(tab.id);
          discardAutoSave(tab.filePath);
          deleteRecoveryBackup(tab.id);
        }
        set({
          documents: [],
          activeTabId: undefined,
          mainActiveTabId: undefined,
          rightActiveTabId: undefined,
          focusedEditorPane: 'main',
          rightPaneOpen: false,
          rightPaneActiveTabKey: undefined,
          outlineTabOpen: false,
          activityPanelPinnedRight: false,
          currentFileURI: null,
          currentFilePath: null,
          fileContent: '',
          isDirty: false,
          pendingScrollHeading: null,
          pendingRevealTarget: null,
          pendingBookTarget: null,
          editorId: null,
          pendingDirtyTabClose: null,
        });
        void syncWatches();
      },

      saveFile: async (options) => {
        const snapshot = get();
        const { activeTabId, fileContent, currentDir } = snapshot;
        const activeTab = getOpenDocuments(snapshot).find(
          (t) => t.id === (options?.tabId || activeTabId),
        );
        if (!activeTab) return;

        let targetPath = options?.saveAs ? undefined : activeTab.filePath;

        // Untitled tab: show save dialog to get file path
        if (!targetPath) {
          const { requestSaveFileDialog } =
            await import('../components/FileDialog/saveFileDialogBridge');
          let defaultName = activeTab.title.endsWith('.md')
            ? activeTab.title
            : `${activeTab.title}.md`;
          if (options?.saveAs) defaultName = defaultName.replace(/(\.[^.]+)$/, '-copy$1');
          const result = await requestSaveFileDialog({
            workspaceViewId: workspaceTabId,
            defaultDir: currentDir,
            defaultFileName: defaultName,
          });
          if (!result) return;
          targetPath = result;
        }

        // At this point targetPath is guaranteed to be a string
        if (!targetPath) return;

        const saved = await persistTabContent(
          activeTab.id,
          targetPath,
          activeTab.content,
        );
        if (!saved) {
          return;
        }
      },

      saveTabByPath: async (path: string, tabId?: string) => {
        const normalizedPath = normalizePosixPath((path || '').trim());
        if (!normalizedPath) {
          return false;
        }
        const targetTab = getOpenDocuments(get()).find(
          (tab) =>
            (!tabId || tab.id === tabId) && normalizePosixPath((tab.filePath || '').trim()) === normalizedPath,
        );
        if (!targetTab || !targetTab.filePath || !targetTab.isDirty) {
          return true;
        }
        return persistTabContent(
          targetTab.id,
          targetTab.filePath,
          targetTab.content,
        );
      },

      flushDirtyTabs: async () => {
        const state = get();
        const dirtyTabs = getOpenDocuments(state).filter((tab) => tab.isDirty);
        let saved = 0;
        const failed: string[] = [];
        let recoverySafe = false;

        if (window.hulala?.backup?.stage && window.hulala.backup.flush) {
          for (const tab of dirtyTabs) {
            stageRecoveryBackup(tab);
          }
          try {
            await window.hulala.backup.flush();
            recoverySafe = true;
          } catch (error) {
            console.error('Failed to flush recovery backups:', error);
          }
        }

        for (const tab of dirtyTabs) {
          if (tab.filePath && !tab.recoveredFromBackup) {
            const persisted = await persistTabContent(
              tab.id,
              tab.filePath,
              tab.content,
            );
            if (persisted) {
              saved += 1;
            } else if (!recoverySafe) {
              failed.push(tab.filePath);
            }
            continue;
          }
          if (!recoverySafe) {
            failed.push(tab.title);
          }
        }

        return { saved, failed };
      },

      setFileContent: (content: string) => {
        const snapshot = get();
        const { fileContent, activeTabId } = snapshot;
        if (content !== fileContent) {
          set((state) => {
            if (!state.activeTabId) {
              return { fileContent: content, isDirty: true };
            }
            const nextTabs = getOpenDocuments(state).map((tab) =>
              tab.id === state.activeTabId
                ? normalizeDocumentTab({ ...tab, content, isDirty: true })
                : tab,
            );
            return {
              fileContent: content,
              isDirty: true,
              ...patchDocumentsWithPinnedState(state, nextTabs),
            };
          });

          const activeTab = getOpenDocuments(snapshot).find(
            (t) => t.id === activeTabId,
          );
          if (activeTab) {
            const dirtyTab = normalizeDocumentTab({
              ...activeTab,
              content,
              isDirty: true,
            });
            stageRecoveryBackup(dirtyTab);
          }
          if (activeTab?.filePath) {
            scheduleAutoSave(
              activeTab.filePath,
              activeTab.uri || pathToDocumentURI(activeTab.filePath, get()),
              content,
            );
          }
        }
      },

      setTabContent: (tabId: string, content: string) => {
        const target = getOpenDocuments(get()).find((tab) => tab.id === tabId);
        if (!target || target.content === content) {
          return;
        }

        set((state) => {
          const nextTabs = getOpenDocuments(state).map((tab) =>
            tab.id === tabId
              ? normalizeDocumentTab({ ...tab, content, isDirty: true })
              : tab,
          );
          if (state.activeTabId !== tabId) {
            return patchDocumentsWithPinnedState(state, nextTabs);
          }
          return {
            ...patchDocumentsWithPinnedState(state, nextTabs),
            fileContent: content,
            isDirty: true,
          };
        });

        const dirtyTab = normalizeDocumentTab({
          ...target,
          content,
          isDirty: true,
        });
        stageRecoveryBackup(dirtyTab);
        if (target.filePath) {
          scheduleAutoSave(
            target.filePath,
            target.uri || pathToDocumentURI(target.filePath, get()),
            content,
          );
        }
      },

      saveEditorViewState: (identity, viewState) => {
        const tabOpen = get().documents.some((tab) => tab.id === identity.tabId);
        editorViewStates.save(identity, viewState, { tabOpen });
      },

      loadEditorViewState: (identity, kind) => {
        return editorViewStates.load(identity, kind);
      },

      setPendingScrollHeading: (heading: string | null) => {
        set((state) => {
          if (!state.activeTabId) {
            return { pendingScrollHeading: heading };
          }
          const nextTabs = getOpenDocuments(state).map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, pendingScrollHeading: heading }
              : tab,
          );
          return {
            pendingScrollHeading: heading,
            ...patchDocumentsWithPinnedState(state, nextTabs),
          };
        });
      },

      setPendingRevealTarget: (reveal: EditorRevealTarget | null) => {
        set((state) => {
          if (!state.activeTabId) {
            return { pendingRevealTarget: reveal };
          }
          const nextTabs = getOpenDocuments(state).map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, pendingRevealTarget: reveal }
              : tab,
          );
          return {
            pendingRevealTarget: reveal,
            ...patchDocumentsWithPinnedState(state, nextTabs),
          };
        });
      },

      setPendingBookTarget: (target: BookOpenTarget | null) => {
        set((state) => {
          if (!state.activeTabId) {
            return { pendingBookTarget: target };
          }
          const nextTabs = getOpenDocuments(state).map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, pendingBookTarget: target }
              : tab,
          );
          return {
            pendingBookTarget: target,
            ...patchDocumentsWithPinnedState(state, nextTabs),
          };
        });
      },

      setEditorFocused: (focused: boolean) => {
        set((state) =>
          state.editorFocused === focused ? {} : { editorFocused: focused },
        );
      },

      requestEditorFocus: (tabId?: string | null) => {
        const state = get();
        const id = (tabId || state.activeTabId || '').trim();
        if (!id || state.activeTabId !== id) {
          return false;
        }
        set((current) => ({
          editorFocusRequest: nextEditorFocusRequest(current, id, true),
        }));
        return true;
      },

      consumeEditorFocusRequest: (tabId: string) => {
        const id = (tabId || '').trim();
        const request = get().editorFocusRequest;
        if (!id || request?.tabId !== id) {
          return false;
        }
        set({ editorFocusRequest: null });
        return true;
      },

      requestEditorRandomID: async () => crypto.randomUUID(),

      requestEditorBlur: () => {
        set((state) => ({
          editorBlurRequestSeq: state.editorBlurRequestSeq + 1,
        }));
      },

      refreshMessenger: async () => {
        if (get().connectionState !== 'connected' || useTabManagerStore.getState().activeTabId !== workspaceTabId) {
          return;
        }
        try {
          const result = await messengerService.list({ limit: 100 });
          if (useTabManagerStore.getState().activeTabId !== workspaceTabId) return;
          useMessengerStore.getState().setList(
            result.channels || [],
            result.messages || [],
          );
        } catch (error) {
          console.warn('[messenger] refresh failed:', (error as Error).message || error);
        }
      },

      loadMessengerChannel: async (channelID: string) => {
        const normalizedChannelID = (channelID || '').trim();
        if (!normalizedChannelID || get().connectionState !== 'connected') {
          return;
        }
        try {
          const result = await messengerService.channel({
            channelID: normalizedChannelID,
            limit: 500,
          });
          const returnedChannelID = (result.channelID || normalizedChannelID).trim();
          if (returnedChannelID) {
            useMessengerStore.getState().setChannelMessages(
              returnedChannelID,
              result.messages || [],
            );
            await messengerService.markRead({ channelID: returnedChannelID });
          }
        } catch (error) {
          console.warn('[messenger] load channel failed:', (error as Error).message || error);
          throw error;
        }
      },

      replyMessenger: async (input: MessengerReplyInput) => {
        if (get().connectionState !== 'connected') {
          throw new Error('Not connected');
        }
        const result = await messengerService.reply(input);
        const records = result.resolved
          ? [result.resolved, result.record]
          : [result.record];
        const messengerState = useMessengerStore.getState();
        for (const record of records) {
          messengerState.upsertRecord(record);
        }
      },

      markMessengerRead: async (channelIDs?: string[]) => {
        if (get().connectionState !== 'connected') {
          return;
        }
        const ids = Array.from(new Set((channelIDs || [])
          .map((channelID) => (channelID || '').trim())
          .filter(Boolean)));
        if (ids.length === 0) {
          return;
        }
        await Promise.all(ids.map((channelID) => messengerService.markRead({ channelID })));
      },

      archiveMessengerChannel: async (channelID: string) => {
        const normalizedChannelID = (channelID || '').trim();
        if (!normalizedChannelID || get().connectionState !== 'connected') {
          return;
        }
        await messengerService.archive({ channelID: normalizedChannelID });
        useMessengerStore.getState().archiveChannel(normalizedChannelID);
      },

      createFile: async (path: string) => {
        try {
          const result = await fileService.writeFile(path, '', {
            create: true,
            overwrite: false,
          });

          if (result.error) {
            console.error('Failed to create file:', result.error);
            return { success: false, error: result.error };
          }

          const dir = path.substring(0, path.lastIndexOf('/'));
          await get().loadDirectory(dir);
          return { success: true };
        } catch (e) {
          console.error('Error creating file:', e);
          return { success: false, error: (e as Error).message };
        }
      },

      createFolder: async (path: string) => {
        try {
          const result = await fileService.mkdir(path);
          if (result.error) {
            console.error('Failed to create folder:', result.error);
            return { success: false, error: result.error };
          }

          const dir = path.substring(0, path.lastIndexOf('/'));
          await get().loadDirectory(dir);
          return { success: true };
        } catch (e) {
          console.error('Error creating folder:', e);
          return { success: false, error: (e as Error).message };
        }
      },

      deleteEntry: async (path: string, isDir: boolean, options) => {
        try {
          const useTrash = options?.useTrash ?? false;
          const recursive = options?.recursive ?? isDir;
          const result = await fileService.delete(path, recursive, useTrash);
          if (result.error) {
            console.error('Failed to delete entry:', result.error);
            return { success: false, error: result.error };
          }

          // If we are about to close tabs due to deletion, discard any pending auto-saves.
          const isUnderDeletedDir = (tabPath?: string) =>
            !!tabPath &&
            (tabPath === path || (isDir && tabPath.startsWith(`${path}/`)));
          for (const tab of getOpenDocuments(get())) {
            if (isUnderDeletedDir(tab.filePath)) {
              discardAutoSave(tab.filePath);
            }
          }
          const parentDir = path.substring(0, path.lastIndexOf('/'));
          const deletedName = path.substring(path.lastIndexOf('/') + 1);

          set((state) => {
            const affectedTabs = getOpenDocuments(state).filter((tab) =>
              isUnderDeletedDir(tab.filePath),
            );
            if (affectedTabs.length === 0) {
              // Still update expanded/cached dirs if needed.
              const nextExpanded = new Set(state.expandedDirs);
              if (isDir) {
                for (const dir of nextExpanded) {
                  if (dir === path || dir.startsWith(`${path}/`)) {
                    nextExpanded.delete(dir);
                  }
                }
              } else {
                nextExpanded.delete(path);
              }

              const nextDirEntries = new Map(state.dirEntries);
              if (isDir) {
                for (const dir of nextDirEntries.keys()) {
                  if (dir === path || dir.startsWith(`${path}/`)) {
                    nextDirEntries.delete(dir);
                  }
                }
              }
              const parentEntries = nextDirEntries.get(parentDir);
              if (parentEntries) {
                nextDirEntries.set(
                  parentDir,
                  parentEntries.filter((entry) => entry.name !== deletedName),
                );
              }

              return { expandedDirs: nextExpanded, dirEntries: nextDirEntries };
            }
            const nextTabs = getOpenDocuments(state).filter(
              (tab) => !isUnderDeletedDir(tab.filePath),
            );
            const activeTabRemoved =
              state.activeTabId &&
              affectedTabs.some((tab) => tab.id === state.activeTabId);

            const nextExpanded = new Set(state.expandedDirs);
            if (isDir) {
              for (const dir of nextExpanded) {
                if (dir === path || dir.startsWith(`${path}/`)) {
                  nextExpanded.delete(dir);
                }
              }
            } else {
              nextExpanded.delete(path);
            }

            const nextDirEntries = new Map(state.dirEntries);
            if (isDir) {
              for (const dir of nextDirEntries.keys()) {
                if (dir === path || dir.startsWith(`${path}/`)) {
                  nextDirEntries.delete(dir);
                }
              }
            }
            const parentEntries = nextDirEntries.get(parentDir);
            if (parentEntries) {
              nextDirEntries.set(
                parentDir,
                parentEntries.filter((entry) => entry.name !== deletedName),
              );
            }

            if (!activeTabRemoved) {
              return {
                ...patchDocumentsWithPinnedState(state, nextTabs),
                expandedDirs: nextExpanded,
                dirEntries: nextDirEntries,
              };
            }
            const nextActiveTab = nextTabs[0];
            if (!nextActiveTab) {
              return {
                documents: [],
                activeTabId: undefined,
                mainActiveTabId: undefined,
                rightActiveTabId: undefined,
                focusedEditorPane: 'main',
                rightPaneOpen: false,
                rightPaneActiveTabKey: undefined,
                outlineTabOpen: false,
                activityPanelPinnedRight: false,
                currentFileURI: null,
                currentFilePath: null,
                fileContent: '',
                isDirty: false,
                pendingScrollHeading: null,
                pendingRevealTarget: null,
                pendingBookTarget: null,
                editorId: null,
                expandedDirs: nextExpanded,
                dirEntries: nextDirEntries,
              };
            }
            return {
              ...patchDocumentsWithPinnedState(state, nextTabs),
              activeTabId: nextActiveTab.id,
              ...(nextActiveTab.pane === 'right'
                ? { rightActiveTabId: nextActiveTab.id, focusedEditorPane: 'right' as const }
                : { mainActiveTabId: nextActiveTab.id, focusedEditorPane: 'main' as const }),
              ...toActiveState(nextActiveTab),
              expandedDirs: nextExpanded,
              dirEntries: nextDirEntries,
            };
          });

          await get().loadDirectory(parentDir);
          return { success: true };
        } catch (e) {
          console.error('Error deleting entry:', e);
          return { success: false, error: (e as Error).message };
        }
      },

      moveEntries: async (ops) => {
        const normalizedOps = ops
          .map((op) => ({
            oldPath: (op.oldPath || '').trim(),
            newPath: (op.newPath || '').trim(),
          }))
          .filter(
            (op) => !!op.oldPath && !!op.newPath && op.oldPath !== op.newPath,
          )
          .sort((a, b) => b.oldPath.length - a.oldPath.length);

        if (normalizedOps.length === 0) {
          return { success: true };
        }

        try {
          const remoteSession = get().remoteSession;
          const movedDirtyTabIDs = new Set(
            getOpenDocuments(get())
              .filter((tab) => tab.isDirty && normalizedOps.some(({ oldPath }) => (
                isSameOrChildPath(tab.filePath, oldPath)
              )))
              .map((tab) => tab.id),
          );
          for (const tabId of movedDirtyTabIDs) {
            const tab = getOpenDocuments(get()).find(document => document.id === tabId);
            if (tab?.filePath && (!await persistTabContent(tab.id, tab.filePath, tab.content) || getOpenDocuments(get()).find(document => document.id === tabId)?.isDirty)) {
              throw new Error('Save or resolve the file conflict before moving this document. Your draft is retained.');
            }
          }
          for (const { oldPath, newPath } of normalizedOps) {
            const result = await fileService.rename(oldPath, newPath);
            if (result.error || !result.success) {
              throw new Error(result.error || `Failed to rename ${oldPath}`);
            }
            if (result.versionBefore && result.versionAfter) set(state => patchDocumentsWithPinnedState(state, getOpenDocuments(state).map(tab => tab.filePath === oldPath && tab.fileVersion === result.versionBefore ? { ...tab, fileVersion: result.versionAfter } : tab)));
            get().retargetMovedTabs([{ oldPath, newPath }]);
          }

          set((state) => {
            for (const tab of getOpenDocuments(state)) {
              const tabPath = tab.filePath || '';
              for (const { oldPath } of normalizedOps) {
                if (isSameOrChildPath(tabPath, oldPath)) {
                  discardAutoSave(tabPath);
                  break;
                }
              }
            }

            const nextExpanded = new Set<string>();
            for (const dir of state.expandedDirs) {
              nextExpanded.add(replaceMovedPath(dir, normalizedOps) || dir);
            }

            const nextDirEntries = new Map<string, FileEntry[]>();
            for (const [dir, entries] of state.dirEntries.entries()) {
              nextDirEntries.set(
                replaceMovedPath(dir, normalizedOps) || dir,
                replaceMovedEntries(dir, entries, normalizedOps),
              );
            }

            return {
              expandedDirs: nextExpanded,
              dirEntries: nextDirEntries,
            };
          });

          await reloadOpenTabsByPaths(getOpenDocuments(get()).filter(tab => normalizedOps.some(op => isSameOrChildPath(tab.filePath, op.newPath))).map(tab => tab.filePath!), { skipDirty: true });
          for (const tab of getOpenDocuments(get())) {
            if (!movedDirtyTabIDs.has(tab.id) || !tab.isDirty || !tab.filePath) {
              continue;
            }
            stageRecoveryBackup(tab);
            scheduleAutoSave(
              tab.filePath,
              tab.uri || pathToDocumentURI(tab.filePath, get()),
              tab.content,
            );
          }

          const dirsToReload = new Set<string>();
          for (const { oldPath, newPath } of normalizedOps) {
            const oldDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
            const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
            if (oldDir) dirsToReload.add(oldDir);
            if (newDir) dirsToReload.add(newDir);
          }
          await Promise.all(
            Array.from(dirsToReload).map((dir) => get().loadDirectory(dir)),
          );

          return { success: true };
        } catch (e) {
          console.error('Error moving entries:', e);
          return { success: false, error: (e as Error).message };
        }
      },

      copyEntries: async (ops) => {
        const normalizedOps = ops
          .map((op) => ({
            sourcePath: (op.sourcePath || '').trim(),
            targetPath: (op.targetPath || '').trim(),
          }))
          .filter(
            (op) =>
              !!op.sourcePath &&
              !!op.targetPath &&
              op.sourcePath !== op.targetPath,
          );

        if (normalizedOps.length === 0) {
          return { success: true };
        }

        try {
          for (const { sourcePath, targetPath } of normalizedOps) {
            const result = await fileService.copy(
              sourcePath,
              targetPath,
              false,
            );
            if (result.error) {
              throw new Error(result.error);
            }
          }

          const dirsToReload = new Set<string>();
          for (const { targetPath } of normalizedOps) {
            const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
            if (dir) dirsToReload.add(dir);
          }
          await Promise.all(
            Array.from(dirsToReload).map((dir) => get().loadDirectory(dir)),
          );
          return { success: true };
        } catch (e) {
          console.error('Error copying entries:', e);
          return { success: false, error: (e as Error).message };
        }
      },

      renameEntry: async (oldPath: string, newPath: string) => {
        return get().moveEntries([{ oldPath, newPath }]);
      },

      persistPastedImage: async (
        base64: string,
        documentPath?: string | null,
      ) => {
        const currentFilePath =
          (documentPath || '').trim() || (get().currentFilePath || '').trim();
        if (!currentFilePath) {
          return { error: '请先保存 Markdown 文件后再粘贴图片' };
        }
        try {
          const file = base64ToFile(
            base64,
            `image-${formatImageTimestamp(new Date())}.png`,
            'image/png',
          );
          const result = await importFile({
            purpose: 'markdown-image',
            targetDocumentPath: currentFilePath,
            file,
          }, workspaceTabId);
          const relativePath = (result.documentRef || '').trim();
          const fileName =
            relativePath
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/i, '') || '';
          if (!fileName) {
            return { error: '写入图片文件失败' };
          }
          return {
            markdown: buildPastedImageMarkdown(relativePath, fileName),
            documentRef: relativePath,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : '写入图片文件失败',
          };
        }
      },

      readTextFile: async (path: string) => {
        try {
          const result = await fileService.readFile(path);
          if (result.error || result.tooLarge) {
            return null;
          }
          return typeof result.content === 'string' ? result.content : '';
        } catch {
          return null;
        }
      },

      writeTextFile: async (path: string, content: string, baseline: string | null = null) => {
        try {
          let expectedVersion: string | null = null;
          if (baseline !== null) {
            const observed = await fileService.readFile(path);
            if (observed.error || observed.content !== baseline || !observed.version) return false;
            expectedVersion = observed.version;
          }
          const result = await fileService.writeFile(path, content, {
            expectedVersion,
            create: true,
            overwrite: true,
            atomic: true,
          });
          if (result.error) {
            return false;
          }
          const parentDir = dirnamePosix(path.trim());
          if (parentDir) {
            await get().loadDirectory(parentDir);
          }
          return true;
        } catch {
          return false;
        }
      },

      writeBase64File: async (
        path: string,
        base64: string,
        options?: { overwrite?: boolean },
      ) => {
        try {
          let expectedVersion: string | null = null;
          if (options?.overwrite) {
            const metadata = await window.hulala!.desktop.files.stat(workspaceTabId, path).catch((error: { status?: number }) => { if (error.status !== 404) throw error; return null; });
            expectedVersion = metadata?.version ?? null;
          }
          await uploadFileToPath(base64ToFile(base64, getFileTitle(path), 'application/octet-stream'), path, workspaceTabId, expectedVersion);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '写入文件失败',
          };
        }
      },

      ensureDerivedDirs: async (opts?: { force?: boolean }) => {
        const derived = await ensureSystemConfig(opts);
        if (derived) {
          set({
            baseDir: derived.baseDir,
            workspaceRootDir: derived.workspaceDir,
            instanceID: derived.instanceID,
          });
        }
        return derived;
      },

      refreshVisibleWorkspaceTree: async () => {
        const snapshot = get();
        const currentDir = normalizeDirPath(snapshot.currentDir || '');
        if (snapshot.connectionState !== 'connected' || !currentDir) {
          return;
        }

        const visibleDirs = uniqueDirs([
          currentDir,
          ...Array.from(snapshot.expandedDirs),
        ]);
        if (visibleDirs.length > 0) {
          await Promise.all(visibleDirs.map((dir) => get().loadDirectory(dir)));
        }
      },

      revealInSidebar: async (path: string) => {
        const filePath = (path || '').trim();
        if (!filePath) {
          return;
        }

        const { currentDir, expandedDirs } = get();
        if (!currentDir || !filePath.startsWith(currentDir)) {
          return;
        }

        // Get the relative path from currentDir
        const relativePath = filePath.slice(currentDir.length + 1);
        const parts = relativePath.split('/');

        // Expand all parent directories
        const dirsToExpand: string[] = [];
        let accumulated = currentDir;
        for (let i = 0; i < parts.length - 1; i++) {
          accumulated = `${accumulated}/${parts[i]}`;
          if (!expandedDirs.has(accumulated)) {
            dirsToExpand.push(accumulated);
          }
        }

        // Expand directories one by one to ensure content is loaded
        for (const dir of dirsToExpand) {
          get().toggleDir(dir);
        }

        // Wait for directories to load and DOM to update, then scroll to the file
        const scrollToFile = () => {
          const element = document.querySelector(
            `[data-file-path="${filePath}"]`,
          );
          if (element) {
            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        };

        if (dirsToExpand.length === 0) {
          // No directories to expand, scroll immediately
          requestAnimationFrame(scrollToFile);
        } else {
          // Wait for directories to load (give some time for async loadDirectory)
          setTimeout(scrollToFile, 150);
        }
      },

      restoreBackups: async () => {
        if (recoveryBackupsRestored || !window.hulala?.backup) {
          return;
        }
        recoveryBackupsRestored = true;
        try {
          const loaded = await window.hulala.backup.load();
          const latestByResource = new Map<string, RecoveryBackupRecord>();
          const superseded: RecoveryBackupRecord[] = [];
          for (const backup of loaded) {
            if (backup.editorId === 'conversation-draft') continue;
            if (backup.workspaceTabId !== workspaceTabId) {
              continue;
            }
            if (!backup.filePath && backup.content === '') {
              await window.hulala.backup.delete(backup);
              continue;
            }
            const resourceKey = backup.id;
            const existing = latestByResource.get(resourceKey);
            if (!existing || backup.timestamp >= existing.timestamp) {
              if (existing) {
                superseded.push(existing);
              }
              latestByResource.set(resourceKey, backup);
            } else {
              superseded.push(backup);
            }
          }
          for (const backup of superseded) {
            void window.hulala.backup.delete({
              workspaceTabId: backup.workspaceTabId,
              id: backup.id,
            }).catch(() => undefined);
          }
          const backups = Array.from(latestByResource.values()).sort(
            (a, b) => a.timestamp - b.timestamp,
          );
          if (backups.length === 0) {
            return;
          }
          for (const backup of backups) {
            backupVersions.set(backup.id, backup.contentVersion);
          }

          set((state) => {
            const restoredTabs: EditorTab[] = backups.map((backup) => ({
              id: backup.id,
              title: backup.title,
              uri: backup.uri as CanonicalFileURI | undefined,
              filePath: backup.filePath,
              fileVersion: backup.fileVersion,
              editorId: backup.editorId,
              content: backup.content,
              isDirty: true,
              recoveredFromBackup: true,
              pendingScrollHeading: null,
              pendingRevealTarget: null,
              pendingBookTarget: null,
              pane: backup.pane === 'right' ? 'right' : 'main',
            }));
            const restoredKeys = new Set(restoredTabs.map((tab) =>
              tab.uri || tab.filePath || `untitled:${tab.id}`,
            ));
            const retainedTabs = getOpenDocuments(state).filter((tab) => {
              if (tab.editorId === 'welcome') {
                return false;
              }
              const key = tab.uri || tab.filePath || `untitled:${tab.id}`;
              return !restoredKeys.has(key);
            });
            const allTabs = [...retainedTabs, ...restoredTabs];
            const currentActive = state.activeTabId
              ? allTabs.find((tab) => tab.id === state.activeTabId)
              : null;
            const activeTab = currentActive || restoredTabs[restoredTabs.length - 1];
            const documentPatch = patchDocumentsWithPinnedState(state, allTabs);

            return {
              ...documentPatch,
              activeTabId: activeTab.id,
              mainActiveTabId: activeTab.pane === 'right'
                ? documentPatch.mainActiveTabId
                : activeTab.id,
              rightActiveTabId: activeTab.pane === 'right'
                ? activeTab.id
                : documentPatch.rightActiveTabId,
              rightPaneOpen: Boolean(documentPatch.rightActiveTabId) || state.rightPaneOpen,
              rightPaneActiveTabKey: activeTab.pane === 'right'
                ? `file:${activeTab.id}`
                : documentPatch.rightPaneActiveTabKey,
              focusedEditorPane: activeTab.pane === 'right' ? 'right' : 'main',
              ...toActiveState(activeTab),
            };
          });
        } catch (e) {
          recoveryBackupsRestored = false;
          console.error('Error restoring backups:', e);
        }
      },

      reloadOpenTabsByPaths,

      reloadOpenTabsFromDisk: async () => {
        if (get().connectionState !== 'connected') {
          return;
        }
        const snapshot = get();
        const pathTabs = getOpenDocuments(snapshot).filter(
          (tab) => tab.filePath && tab.uri,
        );
        if (pathTabs.length === 0) {
          return;
        }

        await reloadOpenTabsByPaths(
          pathTabs.map((tab) => tab.filePath!),
          { skipDirty: false },
        );
      },


      reloadVisibleWorkspaceAfterGitChange: async () => {
        if (get().connectionState !== 'connected') return;
        const dirsToReload = uniqueDirs([
          get().currentDir,
          ...Array.from(get().expandedDirs),
        ]);
        await Promise.all(dirsToReload.map((dir) => get().loadDirectory(dir)));
        await ensureSystemConfig();
      },

      checkoutGitBranch: async (
        branch: string,
        options?: { create?: boolean },
      ) => {
        const targetBranch = (branch || '').trim();
        const currentDir = normalizeDirPath(get().currentDir || '');
        if (!targetBranch || !currentDir) {
          return { success: false, error: 'No workspace directory selected' };
        }
        if (get().connectionState !== 'connected') {
          return { success: false, error: 'Not connected' };
        }
        if (getOpenDocuments(get()).some((tab) => tab.isDirty)) {
          return {
            success: false,
            error:
              'Please save all modified editor tabs before switching branches',
          };
        }
        if (get().gitInfo.dirty.hasChanges) {
          return {
            success: false,
            error:
              'Please commit or discard Git changes before switching branches',
          };
        }

        const result = await gitService.checkout({
          path: currentDir,
          branch: targetBranch,
          create: options?.create === true,
        });
        if (result.error) {
          return { success: false, error: result.error };
        }

        await get().reloadVisibleWorkspaceAfterGitChange();
        await get().reloadOpenTabsFromDisk();
        await get().refreshGitInfo(currentDir);
        return {
          success: true,
          currentBranch: result.currentBranch || targetBranch,
        };
      },

    };
  });
  queueMicrotask(() => {
    void store.getState().restoreBackups();
  });
  return store;
}

export function getWorkspaceStore(tabId: string): WorkspaceStore {
  const existing = workspaceStores.get(tabId);
  if (existing) {
    return existing;
  }
  const store = createWorkspaceStore(tabId);
  workspaceStores.set(tabId, store);
  return store;
}

export function getActiveWorkspaceStore(): WorkspaceStore {
  const { activeTabId } = useTabManagerStore.getState();
  return getWorkspaceStore(activeTabId);
}

export function setWorkspaceActive(tabId: string, active: boolean) {
  const store = getWorkspaceStore(tabId);
  store.getState().setActive(active);
}

export function removeWorkspaceStore(tabId: string) {
  const store = workspaceStores.get(tabId);
  if (!store) {
    return;
  }
  store.getState().dispose();
  workspaceStores.delete(tabId);
}

export const useAppStore = (<T = AppState>(
  selector?: (state: AppState) => T,
): T => {
  const contextualStore = useContext(WorkspaceStoreContext);
  const activeTabId = useTabManagerStore((state) => state.activeTabId);
  const store = contextualStore ?? getWorkspaceStore(activeTabId);
  const select = selector ?? ((state) => state as unknown as T);
  return useStore(store, select);
}) as AppStoreHook;

export function useWorkspaceStoreApi(): WorkspaceStore {
  const contextualStore = useContext(WorkspaceStoreContext);
  const activeTabId = useTabManagerStore((state) => state.activeTabId);
  return contextualStore ?? getWorkspaceStore(activeTabId);
}

export function useWorkspaceViewId(): string {
  const store = useWorkspaceStoreApi();
  return workspaceViewIdForStore(store);
}

export function workspaceViewIdForStore(store?: WorkspaceStore | null): string {
  return [...workspaceStores].find(([, candidate]) => candidate === store)?.[0] || useTabManagerStore.getState().activeTabId;
}

useAppStore.getState = () => getActiveWorkspaceStore().getState();
useAppStore.getStateByTabId = (tabId: string) =>
  getWorkspaceStore(tabId).getState();
useAppStore.getStoreByTabId = (tabId: string) => getWorkspaceStore(tabId);

export type { AppState };
