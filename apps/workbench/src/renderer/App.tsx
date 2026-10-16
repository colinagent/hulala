import { browserJson, openBrowserWorkspace, openLocalWorkspaceDirectory, openRemoteWorkspace } from '../platform/browser';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar, SIDEBAR_ACTIVITY_RAIL_WIDTH_PX } from './components/Sidebar/Sidebar';
import { DrawingEditor } from './components/Editor/excalidraw/DrawingEditor';
import { MarkdownEditor } from './components/Editor/MarkdownEditor';
import { TextEditor } from './components/Editor/TextEditor';
import { ImageEditor } from './components/Editor/ImageEditor';
import { BookReaderEditor } from './components/Editor/BookReaderEditor';
import { WordEditor } from './components/Editor/WordEditor';
import { EDITOR_TAB_DRAG_MIME, EditorTabBar } from './components/Editor/EditorTabBar';
import { WelcomeEditor } from './components/Editor/WelcomeEditor';
import { LocalPluginView } from './components/Plugins/LocalPluginView';
import { CronTaskEditor } from './components/Editor/CronTaskEditor';
import { CommandsEditor } from './components/Editor/CommandsEditor';
import { ConversationSurface } from './components/Chat/ConversationSurface';
import { ActivityPanel } from './components/Chat/ActivityPanel';
import { ConversationComposerDock } from './components/Chat/ConversationComposerDock';
import { WorkspaceMenu, RightWorkspaceToggle } from './components/WorkspaceActions';
import {
  RightWorkspaceTabBar,
  type RightWorkspaceFileTab,
} from './components/RightWorkspaceTabBar';
import { CreateWorkspaceDialog } from './components/CreateWorkspaceDialog';
import {
  getConnectionStateText,
  getDisplayConnectionState,
  getWorkspaceStore,
  removeWorkspaceStore,
  setLocalRuntimeEndpoint,
  setWorkspaceActive,
  useAppStore,
  WorkspaceStoreContext,
} from './store/appStore';
import {
  rightWorkspaceFileKey,
  useRightWorkspaceStore,
} from './store/rightWorkspaceStore';
import { RemoteConnectModal } from './components/RemoteConnect/RemoteConnectModal';
import { DirectoryPickerDialog } from './components/FileDialog/DirectoryPickerDialog';
import {
  resolveSaveFileDialog,
  useSaveFileDialogRequest,
} from './components/FileDialog/saveFileDialogBridge';
import {
  createRemoteDirectoryPickerProvider,
} from './components/FileDialog/directoryPickerProviders';
import { UnifiedSettingsModal } from './components/Settings/UnifiedSettingsModal';
import { useUiStore } from './store/uiStore';
import { useConversationStore } from './store/conversationStore';
import { syncHarnessPresentation } from './services/harnessSettingsService';
import { editorRegistry } from './services/editorRegistry';
import {
  useTabManagerStore,
  resolveHostLabel,
  type SshHost,
  type WorkspaceTabSession,
  type WorkspaceTabsSessionState,
} from './store/tabManagerStore';
import { getRemoteBucketByInstanceID, useRecentWorkspacesStore } from './store/recentWorkspacesStore';
import { ResizeDivider } from './components/ResizeDivider';
import { NewWindowLanding } from './components/Window/NewWindowLanding';
import { ToastViewport } from './components/ToastViewport';
import { PopupMenu } from './components/PopupMenu';
import { BranchStatusControl } from './components/BranchStatusControl';
import { BrowserSaveStatus } from './components/BrowserSaveStatus';
import { BrowserReferenceDialog } from '../platform/BrowserReferenceDialog';
import { browserContext } from '../platform/contexts';
import { BROWSER_REFERENCE_MIME, decodeBrowserReference, pinBrowserReference, persistBrowserReferences, restoreBrowserReferences } from './services/browserReferences';
import { EditorTextZoomStatusControl } from './components/EditorTextZoomStatusControl';
import { EpubTextZoomStatusControl } from './components/EpubTextZoomStatusControl';
import { EpubReadingProgressStatusControl } from './components/EpubReadingProgressStatusControl';
import { SidebarPanelToggleIcon } from './components/Icons';
import { isEpubFilePath } from './components/Editor/epubReaderSettings';
import { PdfReadingProgressStatusControl } from './components/PdfReadingProgressStatusControl';
import { PdfZoomStatusControl } from './components/PdfZoomStatusControl';
import { isPdfFilePath } from './components/Editor/pdfReaderState';
import { UnsavedTabCloseDialog } from './components/UnsavedTabCloseDialog';
import { formatStatusBarPathDisplay } from './utils/statusBarPath';
import { countMarkdownWords } from './utils/markdownWordCount';
import { normalizePosixPath } from './utils/markdownMedia';
import { useToastStore } from './store/toastStore';

// Keep the sidebar wide enough so the tab bar never overflows into the resize divider hit area.
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 300;
const RESIZE_DIVIDER_HOVER_DELAY_MS = 80;
const PINNED_FILE_PANEL_MIN_WIDTH = 320;
const PINNED_FILE_PANEL_MAX_WIDTH = 1200;
const DEFAULT_PINNED_FILE_PANEL_WIDTH = 420;
const PINNED_FILE_PANEL_PRIMARY_MIN_WIDTH = 260;
const APP_BOOTSTRAP_RENDER_TIMEOUT_MS = 5_000;

type DirectoryPickerRequest = {
  source: 'switch-remote-workspace';
  tabId: string;
  currentPath: string | null;
};

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function resolveSidebarWidth(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return clampSidebarWidth(value);
}

function normalizeWorkspacePathKey(value: string | null | undefined) {
  const normalized = (value || '').trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function getLocalPathBaseName(value: string | null | undefined) {
  const normalized = normalizeWorkspacePathKey(value);
  if (!normalized || normalized === '/') {
    return 'workspace';
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'workspace';
}

function normalizePinnedFilePanelWidth(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PINNED_FILE_PANEL_WIDTH;
  }
  return Math.min(
    PINNED_FILE_PANEL_MAX_WIDTH,
    Math.max(PINNED_FILE_PANEL_MIN_WIDTH, value)
  );
}

type UiSettingsSnapshot = {
  ui?: {
    sidebarWidth?: unknown;
    pinnedFilePanelWidth?: unknown;
  };
};

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < tasks.length) {
      const taskIndex = index;
      index += 1;
      await tasks[taskIndex]();
    }
  });
  await Promise.all(workers);
}

function getWorkspaceOpenEditorFilePaths(tabId: string): string[] {
  const workspaceState = getWorkspaceStore(tabId).getState();
  return Array.from(new Set(
    workspaceState.documents
      .map((tab) => normalizePosixPath((tab.filePath || '').trim()))
      .filter(Boolean)
  ));
}

async function waitForWorkspaceConnection(tabId: string, timeoutMs = 15000): Promise<boolean> {
  const store = getWorkspaceStore(tabId);
  if (store.getState().connectionState === 'connected') {
    return true;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    if (store.getState().connectionState === 'connected') {
      return true;
    }
  }

  return store.getState().connectionState === 'connected';
}

let builtInEditorsRegistered = false;

function registerBuiltInEditors() {
  if (builtInEditorsRegistered) {
    return;
  }
  builtInEditorsRegistered = true;

  editorRegistry.register({
    id: 'markdown',
    displayName: 'Markdown Editor',
    component: MarkdownEditor,
  });
  editorRegistry.register({
    id: 'text',
    displayName: 'Text Editor',
    component: TextEditor,
  });
  editorRegistry.register({
    id: 'excalidraw',
    displayName: 'Drawing Editor',
    component: DrawingEditor,
  });
  editorRegistry.register({
    id: 'image',
    displayName: 'Image Preview',
    component: ImageEditor,
  });
  editorRegistry.register({
    id: 'pdf',
    displayName: 'Book Reader',
    component: BookReaderEditor,
  });
  editorRegistry.register({
    id: 'book',
    displayName: 'Book Reader',
    component: BookReaderEditor,
  });
  editorRegistry.register({
    id: 'word',
    displayName: 'Word Preview',
    component: WordEditor,
  });
  editorRegistry.register({
    id: 'welcome',
    displayName: 'Welcome',
    component: WelcomeEditor,
  });
  editorRegistry.register({
    id: 'cron-task',
    displayName: 'Cron Task',
    component: CronTaskEditor,
  });
}

export default function App() {
  const { t, i18n } = useTranslation(['menu', 'shell', 'common', 'error']);
  const {
    currentDir,
    setCurrentDir,
    ensureDirectory,
    connectionState,
    connect,
    setRemoteSession,
    remoteSession,
    remoteError,
    baseDir,
    openWelcomeTab,
  } = useAppStore();
  const displayConnectionState = useAppStore(getDisplayConnectionState);
  const pendingDirtyTabClose = useAppStore((state) => state.pendingDirtyTabClose);
  const dismissPendingDirtyTabClose = useAppStore((state) => state.dismissPendingDirtyTabClose);
  const confirmPendingDirtyTabClose = useAppStore((state) => state.confirmPendingDirtyTabClose);
  const activeTabId = useTabManagerStore((state) => state.activeTabId);
  const workspaceTabs = useTabManagerStore((state) => state.tabs);
  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeTabId) || null;
  const setActiveWorkspaceTab = useTabManagerStore((state) => state.setActiveTab);
  const createWorkspaceTab = useTabManagerStore((state) => state.createTab);
  const closeWorkspaceTab = useTabManagerStore((state) => state.closeTab);
  const updateTabWorkspace = useTabManagerStore((state) => state.updateTabWorkspace);
  const updateActiveTabWorkspace = useTabManagerStore((state) => state.updateActiveTabWorkspace);
  const openUnifiedSettings = useUiStore((state) => state.openSettings);
  const desktopThemeScheme = useUiStore((state) => state.theme.scheme);
  const sidebarPanelOpen = useUiStore((state) => state.sidebarPanelOpen);
  const composerOpen = useUiStore((state) => state.composerOpen);
  const workspaceDocuments = useAppStore((state) => state.documents);
  const mainActiveTabId = useAppStore((state) => state.mainActiveTabId);
  const rightPaneOpen = useRightWorkspaceStore((state) => state.open);
  const rightFileRefs = useRightWorkspaceStore((state) => state.files);
  const rightPaneActiveTabKey = useRightWorkspaceStore((state) => state.activeTabKey);
  const outlineTabOpen = useRightWorkspaceStore((state) => state.outlineOpen);
  const activityPanelPinnedRight = useRightWorkspaceStore((state) => state.activityPinned);
  const setRightPaneOpen = useRightWorkspaceStore((state) => state.setOpen);
  const addRightFile = useRightWorkspaceStore((state) => state.addFile);
  const removeRightFile = useRightWorkspaceStore((state) => state.removeFile);
  const selectRightTab = useRightWorkspaceStore((state) => state.selectTab);
  const closeOutlineInRightPane = useRightWorkspaceStore((state) => state.closeOutline);
  const setActivityPanelPinnedRight = useRightWorkspaceStore((state) => state.setActivityPinned);
  const hasCurrentConversationActivity = useConversationStore(activeTabId, (state) => {
    const activeSessionId = activeWorkspaceTab?.activeSessionId;
    if (!activeSessionId || state.activeSessionId !== activeSessionId) return false;
    const session = state.sessions.find((candidate) => candidate.sessionId === activeSessionId);
    const snapshot = state.snapshots[activeSessionId];
    const hasContent = Boolean(
      (snapshot?.items.length || 0) > 0
      || session?.running
      || snapshot?.pendingInteractions.length
      || state.error
      || snapshot?.projections.values.todos
      || snapshot?.projections.values.plan,
    );
    return Boolean(session && !session.blank && hasContent);
  });
  const activityPanelPinnedForCurrentWorkspace = activityPanelPinnedRight && hasCurrentConversationActivity;
  const [rightWorkspaceRevision, setRightWorkspaceRevision] = useState(0);
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
  const [closingReference, setClosingReference] = useState<RightWorkspaceFileTab | null>(null);
  const referencesRestored = useRef(false);
  const primaryEditorTab = mainActiveTabId
    ? workspaceDocuments.find((tab) => tab.id === mainActiveTabId) || null
    : null;
  const rightFileTabs = useMemo<RightWorkspaceFileTab[]>(() => rightFileRefs.flatMap((ref) => {
    const sourceState = getWorkspaceStore(ref.workspaceTabId).getState();
    const document = sourceState.documents.find((tab) => tab.id === ref.tabId);
    return document ? [{ ref, document, connectionState: sourceState.connectionState }] : [];
  }), [rightFileRefs, rightWorkspaceRevision]);
  const fallbackRightTabKey = rightFileTabs.length > 0
    ? rightWorkspaceFileKey(rightFileTabs[rightFileTabs.length - 1].ref)
    : outlineTabOpen
      ? 'outline'
      : undefined;
  const rightPaneActiveTabKeyForCurrentWorkspace = rightPaneActiveTabKey === 'activity'
    && !activityPanelPinnedForCurrentWorkspace
    ? fallbackRightTabKey
    : rightPaneActiveTabKey;
  const activeRightFile = rightFileTabs.find(
    (file) => rightWorkspaceFileKey(file.ref) === rightPaneActiveTabKeyForCurrentWorkspace,
  ) || null;
  const rightPaneBlockedByUnavailableActivity = rightPaneActiveTabKey === 'activity'
    && !activityPanelPinnedForCurrentWorkspace
    && !fallbackRightTabKey;
  const showRightPane = rightPaneOpen && !rightPaneBlockedByUnavailableActivity;
  const canShowRightPanelStatus = showRightPane && Boolean(activeRightFile);
  const activeStatusDocument = primaryEditorTab;
  const activeStatusEditorId = activeStatusDocument?.editorId;
  const activeStatusTabId = activeStatusDocument?.id;
  const activeStatusCurrentDir = currentDir;
  const activeStatusConnectionState = displayConnectionState;
  const activeStatusRemoteSession = remoteSession;
  const activeStatusRemoteError = remoteError;
  const activeStatusFilePath = (activeStatusDocument?.filePath || '').trim();
  const statusBarPathDisplay = useMemo(
    () => formatStatusBarPathDisplay(activeStatusCurrentDir, activeStatusFilePath),
    [activeStatusCurrentDir, activeStatusFilePath],
  );
  const showEpubTextZoom = activeStatusEditorId === 'book' && isEpubFilePath(activeStatusFilePath);
  const showPdfReadingControls = Boolean(
    activeStatusTabId
    && (activeStatusEditorId === 'pdf' || activeStatusEditorId === 'book')
    && isPdfFilePath(activeStatusFilePath),
  );
  const showMarkdownWordCount = activeStatusDocument?.editorId === 'markdown';
  const markdownWordCount = useMemo(
    () => showMarkdownWordCount ? countMarkdownWords(activeStatusDocument?.content || '') : 0,
    [activeStatusDocument?.content, showMarkdownWordCount],
  );
  const markdownWordCountLabel = markdownWordCount.toLocaleString();
  const sideStatusDocument = activeRightFile?.document || null;
  const sideStatusFilePath = (sideStatusDocument?.filePath || '').trim();
  const sideStatusWorkspaceState = activeRightFile
    ? getWorkspaceStore(activeRightFile.ref.workspaceTabId).getState()
    : null;
  const sideStatusPathDisplay = useMemo(
    () => formatStatusBarPathDisplay(sideStatusWorkspaceState?.currentDir || null, sideStatusFilePath),
    [sideStatusFilePath, sideStatusWorkspaceState?.currentDir],
  );
  const sideShowEpubTextZoom = sideStatusDocument?.editorId === 'book' && isEpubFilePath(sideStatusFilePath);
  const sideShowPdfReadingControls = Boolean(
    sideStatusDocument?.id
    && (sideStatusDocument.editorId === 'pdf' || sideStatusDocument.editorId === 'book')
    && isPdfFilePath(sideStatusFilePath),
  );
  const sideShowMarkdownWordCount = sideStatusDocument?.editorId === 'markdown';
  const sideMarkdownWordCount = useMemo(
    () => sideShowMarkdownWordCount ? countMarkdownWords(sideStatusDocument?.content || '') : 0,
    [sideShowMarkdownWordCount, sideStatusDocument?.content],
  );
  const sideMarkdownWordCountLabel = sideMarkdownWordCount.toLocaleString();
  const sideHasDocumentControls = sideShowEpubTextZoom
    || sideShowPdfReadingControls
    || sideShowMarkdownWordCount;
  const recentWorkspaces = useRecentWorkspacesStore((state) => state.recent);
  const loadRecentWorkspaces = useRecentWorkspacesStore((state) => state.load);
  const [windowActive, setWindowActive] = useState(true);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceName, setCreateWorkspaceName] = useState('');
  const [createWorkspaceRemoteHost, setCreateWorkspaceRemoteHost] = useState<SshHost | null>(null);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [directoryPickerRequest, setDirectoryPickerRequest] = useState<DirectoryPickerRequest | null>(null);
  const [remoteModalTarget, setRemoteModalTarget] = useState<'current' | 'newTab' | 'newWindow' | 'createWorkspace'>('current');
  const [isNewWindowLanding, setIsNewWindowLanding] = useState(false);
  const [openingLandingFolder, setOpeningLandingFolder] = useState(false);
  const [appInitialized, setAppInitialized] = useState(false);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const editorContentRowRef = useRef<HTMLDivElement | null>(null);
  const rightEditorPaneRef = useRef<HTMLDivElement | null>(null);
  const prevActiveTabRef = useRef<string | null>(null);
  const sessionSyncReadyRef = useRef(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null);
  const pinnedFilePanelResizeRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null);
  const isMac = window.hulala?.platform === 'darwin'
    || /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [pinnedFilePanelWidth, setPinnedFilePanelWidth] = useState(DEFAULT_PINNED_FILE_PANEL_WIDTH);
  const [draggingEditorTabId, setDraggingEditorTabId] = useState<string | null>(null);
  const [sidePanelStatusOpen, setSidePanelStatusOpen] = useState(false);
  const sidePanelStatusPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!canShowRightPanelStatus) {
      setSidePanelStatusOpen(false);
    }
  }, [canShowRightPanelStatus]);

  useEffect(() => {
    if (!sidePanelStatusOpen) {
      return undefined;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (!sidePanelStatusPopoverRef.current?.contains(event.target as Node)) {
        setSidePanelStatusOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidePanelStatusOpen(false);
      }
    };
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidePanelStatusOpen]);

  const pushWorkspaceTabsSession = async () => {
    if (!sessionSyncReadyRef.current || !window.hulala?.window?.updateWorkspaceTabsSession) {
      return;
    }
    const baseSnapshot = useTabManagerStore.getState().getSessionSnapshot((tabId) => {
      return getWorkspaceStore(tabId).getState().currentDir;
    });
    const snapshot = {
      ...baseSnapshot,
      tabs: baseSnapshot.tabs.map((tab) => {
        const openEditorFilePaths = getWorkspaceOpenEditorFilePaths(tab.id);
        const state = getWorkspaceStore(tab.id).getState();
        const openEditors = state.documents.filter(document => document.filePath).map(document => ({ path: document.filePath!, pane: document.pane, active: document.id === state.activeTabId }));
        const openTools = state.documents.filter(document => document.editorId === 'commands' || document.editorId.startsWith('cron-task:')).map(document => ({ editorId: document.editorId, title: document.title, active: document.id === state.activeTabId }));
        return {
          ...tab,
          openEditors,
          openTools,
          ...(openEditorFilePaths.length > 0 ? { openEditorFilePaths } : {}),
        };
      }),
    };
    try {
      await window.hulala.window.updateWorkspaceTabsSession(snapshot);
    } catch (error) {
      console.warn('[workspaceTabsSession] failed to sync:', error);
    }
  };

  const scheduleWorkspaceTabsSessionSync = () => {
    if (!sessionSyncReadyRef.current) {
      return;
    }
    // The browser adapter writes small view metadata synchronously. A debounce
    // loses freshly opened tabs when the user immediately reloads the page.
    void pushWorkspaceTabsSession();
  };

  const restoreWorkspaceEditors = async (tab: WorkspaceTabSession) => {
    const store = getWorkspaceStore(tab.id);
    if (!await waitForWorkspaceConnection(tab.id)) return;
    const editors = tab.openEditors || (tab.openEditorFilePaths || []).map(path => ({ path, pane: 'main' as const, active: false }));
    for (const editor of editors) await store.getState().openFile(editor.path, { pane: editor.pane });
    for (const tool of tab.openTools || []) {
      if (tool.editorId === 'commands') store.getState().openCommandsTab();
      else if (/^cron-task:(?:new|[a-f0-9-]{36})$/.test(tool.editorId)) store.getState().openCronTaskTab(tool.editorId.slice(10), tool.title);
    }
    const selected = editors.find(editor => editor.active);
    const selectedTab = store.getState().documents.find(document => document.filePath === selected?.path);
    if (selectedTab) store.getState().setActiveTab(selectedTab.id);
    const selectedTool = tab.openTools?.find(tool => tool.active);
    const toolTab = selectedTool && store.getState().documents.find(document => document.editorId === selectedTool.editorId);
    if (toolTab) store.getState().setActiveTab(toolTab.id);
  };

  const restoreLocalWorkspaceTab = async (tab: WorkspaceTabSession, active: boolean) => {
    const store = getWorkspaceStore(tab.id);
    const state = store.getState();
    const nextDir = tab.currentDir || tab.workspacePath;
    if (nextDir) {
      useTabManagerStore.getState().updateTabWorkspace(tab.id, {
        kind: 'local',
        workspacePath: nextDir,
      });
    }
    if (nextDir) {
      state.setCurrentDir(nextDir);
      if (active) {
        state.connect();
        await state.ensureDirectory(nextDir);
      }
    } else if (active) {
      state.connect();
    }
    if (active) await restoreWorkspaceEditors(tab);
  };

  const restoreRemoteWorkspaceTab = async (tab: WorkspaceTabSession) => {
    if (!tab.remoteHost) {
      return;
    }
    const store = getWorkspaceStore(tab.id);
    store.getState().setServerUrl('');
    store.getState().disconnect();
    const session = await connectRemoteForTab(tab.id, tab.remoteHost);
    const nextDir = tab.currentDir || tab.workspacePath || session?.workspaceDir;
    useTabManagerStore.getState().updateTabWorkspace(tab.id, {
      kind: 'remote',
      remoteHost: tab.remoteHost,
      workspacePath: nextDir || tab.workspacePath,
      label: (nextDir?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace') + ' @ ' + (session?.hostLabel || tab.remoteHost.alias),
    });
    if (nextDir) {
      store.getState().setCurrentDir(nextDir);
      await store.getState().ensureDirectory(nextDir);
    }
    await restoreWorkspaceEditors(tab);
  };

  const restoreWorkspaceTabsSession = async (session: WorkspaceTabsSessionState) => {
    useTabManagerStore.getState().replaceSession(session);
    const restored = useTabManagerStore.getState();
    const tabsById = new Map(session.tabs.map((tab) => [tab.id, tab]));
    const remoteTasks: Array<() => Promise<void>> = [];

    for (const tab of restored.tabs) {
      const restoredTab = tabsById.get(tab.id);
      if (!restoredTab) {
        continue;
      }
      const isActiveTab = tab.id === restored.activeTabId;
      if (restoredTab.kind === 'remote') {
        const task = async () => {
          await restoreRemoteWorkspaceTab(restoredTab);
        };
        if (isActiveTab) {
          remoteTasks.unshift(task);
        } else {
          remoteTasks.push(task);
        }
        continue;
      }
      await restoreLocalWorkspaceTab(restoredTab, isActiveTab);
    }

    await runWithConcurrency(remoteTasks, 2);
  };

  const openSettingsWorkspace = async () => {
    try {
      const settingsDir = (await window.hulala?.settings?.getRoot?.() || '').trim();
      if (!settingsDir) {
        return;
      }

      await openBrowserWorkspace(settingsDir);
    } catch (error) {
      console.error('Failed to open settings workspace:', error);
    }
  };

  async function connectRemoteForTab(tabId: string, host: SshHost) {
    const store = getWorkspaceStore(tabId);
    if (!window.hulala?.remote) {
      store.getState().setRemoteError('Remote API not available');
      return null;
    }
    store.getState().setRemoteConnecting(true);
    store.getState().setRemoteError(null);
    try {
      const session = await window.hulala.remote.connectSsh(host, tabId);
      store.getState().setRemoteSession(session);
      store.getState().connect();
      useTabManagerStore.getState().updateTabWorkspace(tabId, {
        kind: 'remote',
        remoteHost: host,
        label: session.hostLabel,
      });
      return session;
    } catch (err) {
      store.getState().setRemoteError((err as Error).message || 'Remote connect failed');
      return null;
    } finally {
      store.getState().setRemoteConnecting(false);
    }
  }

  async function disconnectRemoteForTab(tabId: string) {
    if (!window.hulala?.remote) {
      return;
    }
    await window.hulala.remote.disconnect(tabId);
    window.location.assign('/open');
  }

  const handleNewFolderTab = async () => {
    try {
      const path = await openLocalWorkspaceDirectory(currentDir && !remoteSession ? currentDir : undefined);
      if (path) await useRecentWorkspacesStore.getState().recordLocal({ path });
    } catch (error) {
      useToastStore.getState().pushToast(error instanceof Error ? error.message : 'Could not open the folder.');
    }
  };

  const handleOpenCreateWorkspace = () => {
    setCreateWorkspaceName('');
    setCreateWorkspaceRemoteHost(null);
    setCreateWorkspaceError(null);
    setCreateWorkspaceBusy(false);
    setCreateWorkspaceOpen(true);
  };

  const handleCreateWorkspaceConnectRemote = () => {
    setCreateWorkspaceError(null);
    setCreateWorkspaceOpen(false);
    setRemoteModalTarget('createWorkspace');
    setShowRemoteModal(true);
  };

  const handleRemoteModalClose = () => {
    setShowRemoteModal(false);
    if (remoteModalTarget === 'createWorkspace') {
      setCreateWorkspaceOpen(true);
    }
  };

  const handleNewRemoteTab = () => {
    setRemoteModalTarget('newTab');
    setShowRemoteModal(true);
  };


  const handleLandingOpenFolder = async () => {
    if (openingLandingFolder) {
      return;
    }
    setOpeningLandingFolder(true);
    try {
      const path = await openLocalWorkspaceDirectory();
      if (path) await useRecentWorkspacesStore.getState().recordLocal({ path });
    } catch (error) {
      useToastStore.getState().pushToast(error instanceof Error ? error.message : 'Could not open the folder.');
    } finally {
      setOpeningLandingFolder(false);
    }
  };

  const handleLandingConnectRemote = () => {
    setRemoteModalTarget('current');
    setShowRemoteModal(true);
  };

  const completeNewWindowLanding = async () => {
    const result = await window.hulala?.window?.completeNewWindowLanding?.();
    if (result && !result.success) {
      throw new Error('Failed to complete the new-window landing');
    }
    setIsNewWindowLanding(false);
    sessionSyncReadyRef.current = true;
    scheduleWorkspaceTabsSessionSync();
  };

  const waitForRemoteInstanceID = async (tabId: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const store = getWorkspaceStore(tabId);
      const state = store.getState();
      const instanceID = (state.instanceID || '').trim();
      if (instanceID) {
        return instanceID;
      }
      if (state.connectionState === 'connected') {
        const derived = await state.ensureDerivedDirs();
        const nextInstanceID = (derived?.instanceID || '').trim();
        if (nextInstanceID) {
          return nextInstanceID;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return null;
  };

  const recordRemoteRecentForTab = async (tabId: string, host: SshHost, path?: string) => {
    try {
      const instanceID = await waitForRemoteInstanceID(tabId);
      if (!instanceID) {
        return;
      }
      const store = getWorkspaceStore(tabId);
      await useRecentWorkspacesStore.getState().recordRemote({
        instanceID,
        host,
        path: path || store.getState().currentDir || undefined,
        label: host.alias,
        lastOpenedAt: Date.now(),
      });
    } catch {
      return;
    }
  };

  const handleSwitchLocalWorkspace = async (path: string) => {
    await openBrowserWorkspace(path);
  };

  const handleSwitchRemoteWorkspace = async (host: SshHost, path?: string) => {
    await openRemoteWorkspace(host, path);
  };

  const handleNewTabWithLocal = async (path: string) => {
    await openBrowserWorkspace(path);
    await useRecentWorkspacesStore.getState().recordLocal({ path });
  };

  /** Title bar "+" recent: open a new tab and connect to this host (do not change current tab). */
  const handleNewTabWithRemote = async (host: SshHost, path?: string) => {
    await openRemoteWorkspace(host, path);
  };

  const managedWorkspaceErrorMessage = (code: string, fallback: string) => {
    if (code === 'workspace_exists') return t('error:workspace.exists');
    if (code === 'workspace_name_invalid') return t('error:workspace.nameInvalid');
    return fallback || t('error:workspace.createFailed');
  };

  const cleanupFailedManagedRemoteTab = async (tabId: string, previousTabId: string) => {
    try {
      await window.hulala?.remote?.disconnect(tabId);
    } catch {
      // The failed provisional connection may already be closed.
    }
    setWorkspaceActive(tabId, false);
    removeWorkspaceStore(tabId);
    closeWorkspaceTab(tabId);
    if (useTabManagerStore.getState().tabs.some((tab) => tab.id === previousTabId)) {
      setActiveWorkspaceTab(previousTabId);
    }
  };

  const handleCreateManagedWorkspace = async () => {
    if (createWorkspaceBusy) return;
    const name = createWorkspaceName.trim();
    if (!name) {
      setCreateWorkspaceError(t('error:workspace.nameRequired'));
      return;
    }
    if (name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/u.test(name)) {
      setCreateWorkspaceError(t('error:workspace.nameInvalid'));
      return;
    }
    const api = window.hulala?.desktop?.workspaces;
    if (!api) {
      setCreateWorkspaceError(t('error:workspace.createFailed'));
      return;
    }

    setCreateWorkspaceBusy(true);
    setCreateWorkspaceError(null);
    try {
      if (!createWorkspaceRemoteHost) {
        const result = await api.createManaged({ kind: 'local' }, name);
        if (!result.ok) {
          setCreateWorkspaceError(managedWorkspaceErrorMessage(result.code, result.message));
          return;
        }
        setCreateWorkspaceOpen(false);
        await handleNewTabWithLocal(result.workspace.path);
        return;
      }

      const host = createWorkspaceRemoteHost;
      await openRemoteWorkspace(host, undefined, name);
      setCreateWorkspaceOpen(false);
    } finally {
      setCreateWorkspaceBusy(false);
    }
  };

  const handleOpenLocalSwitchDirectory = async () => {
    await handleNewFolderTab();
  };

  const handleOpenRemoteSwitchDirectory = () => {
    const store = getWorkspaceStore(activeTabId);
    setDirectoryPickerRequest({
      source: 'switch-remote-workspace',
      tabId: activeTabId,
      currentPath: store.getState().currentDir || remoteSession?.workspaceDir || '/',
    });
  };

  const handleSwitchCurrentRemoteDirectory = async (tabId: string, path: string) => {
    const activeTab = useTabManagerStore.getState().tabs.find((tab) => tab.id === tabId) || null;
    if (!activeTab || activeTab.kind !== 'remote') {
      return;
    }

    if (activeTab.remoteHost) {
      await openRemoteWorkspace(activeTab.remoteHost, path);
    }
  };

  const closeDirectoryPicker = () => {
    setDirectoryPickerRequest(null);
  };

  const handleDirectoryPickerSelect = async (path: string) => {
    if (!directoryPickerRequest) {
      return;
    }

    await handleSwitchCurrentRemoteDirectory(directoryPickerRequest.tabId, path);
  };

  const saveFileRequest = useSaveFileDialogRequest();
  const saveFileProvider = useMemo(
    () => {
      if (!saveFileRequest) return null;
      const viewId = saveFileRequest.workspaceViewId || activeTabId;
      const state = getWorkspaceStore(viewId).getState();
      const root = browserContext(viewId)?.workspace.path || state.currentDir || '/';
      return {
        kind: 'local' as const,
        listDirectory: state.listDirectory,
        statPath: state.statPath,
        getQuickAccess: async () => [{ key: 'workspace', label: 'Workspace', path: root }],
        mkdir: state.createFolder,
        writeFile: async (path: string, content: string) => await state.writeTextFile(path, content) ? {} : { error: 'Could not create this file in the Workspace.' },
      };
    },
    [saveFileRequest, activeTabId],
  );

  const directoryPickerConfig = useMemo(() => {
    if (!directoryPickerRequest) {
      return null;
    }

    if (directoryPickerRequest.source === 'switch-remote-workspace') {
      const store = getWorkspaceStore(directoryPickerRequest.tabId).getState();
      const hostId = workspaceTabs.find(tab => tab.id === directoryPickerRequest.tabId)?.remoteHost?.id;
      const remoteBucket = store.instanceID
        ? getRemoteBucketByInstanceID(recentWorkspaces, store.instanceID)
        : null;
      return {
        provider: hostId ? {
          kind: 'remote' as const,
          listDirectory: (path: string) => browserJson('/api/browser/ssh/directories?' + new URLSearchParams({ hostId, path })),
          statPath: (path: string) => browserJson('/api/browser/ssh/directories/stat?' + new URLSearchParams({ hostId, path })),
          getQuickAccess: async () => store.remoteSession ? [{ key: 'workspace', label: 'Workspace', path: store.remoteSession.workspaceDir }] : [],
        } : createRemoteDirectoryPickerProvider({
          remoteSession: store.remoteSession,
          listDirectory: store.listDirectory,
          statPath: store.statPath,
        }),
        title: 'Switch Directory',
        subtitle: store.remoteSession ? `Remote: ${store.remoteSession.hostLabel}` : 'Remote Workspace',
        defaultPath: directoryPickerRequest.currentPath || store.remoteSession?.workspaceDir || '/',
        currentPath: directoryPickerRequest.currentPath,
        recentPaths: (remoteBucket?.directories || []).map((entry) => entry.path),
        submitLabel: 'Switch',
      };
    }

  }, [directoryPickerRequest, recentWorkspaces]);

  useEffect(() => {
    void loadRecentWorkspaces();
  }, [loadRecentWorkspaces]);

  const disposeRetainedWorkspaceIfUnused = async (workspaceTabId: string) => {
    const stillVisible = useTabManagerStore.getState().tabs.some((tab) => tab.id === workspaceTabId);
    const stillReferenced = useRightWorkspaceStore.getState().files
      .some((ref) => ref.workspaceTabId === workspaceTabId);
    if (stillVisible || stillReferenced) return;
    const sourceStore = getWorkspaceStore(workspaceTabId);
    if (sourceStore.getState().remoteSession) {
      try {
        await window.hulala?.remote?.disconnect(workspaceTabId);
      } catch {
        // The retained remote may already have disconnected while hidden.
      }
    }
    setWorkspaceActive(workspaceTabId, false);
    removeWorkspaceStore(workspaceTabId);
  };

  useEffect(() => {
    const unsubscribers = rightFileRefs.map((ref) => {
      const store = getWorkspaceStore(ref.workspaceTabId);
      if (!store.getState().documents.some((tab) => tab.id === ref.tabId)) {
        removeRightFile(ref);
        queueMicrotask(() => { void disposeRetainedWorkspaceIfUnused(ref.workspaceTabId); });
        return () => undefined;
      }
      return store.subscribe(() => setRightWorkspaceRevision((value) => value + 1));
    });
    if (referencesRestored.current && window.hulala?.kind === 'browser') persistBrowserReferences();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [removeRightFile, rightFileRefs]);

  const moveFileToRightWorkspace = (
    tabId: string,
    sourceWorkspaceTabId = activeTabId,
  ) => {
    const sourceStore = getWorkspaceStore(sourceWorkspaceTabId);
    if (!sourceStore.getState().moveTabToPane(tabId, 'right')) return;
    const sourceTab = useTabManagerStore.getState().tabs.find((tab) => tab.id === sourceWorkspaceTabId);
    addRightFile({
      workspaceTabId: sourceWorkspaceTabId,
      tabId,
      ...(sourceTab ? {
        source: {
          kind: sourceTab.kind,
          workspacePath: sourceTab.workspacePath,
          remoteHost: sourceTab.remoteHost,
          label: sourceTab.label,
          workspaceId: sourceTab.workspaceId,
        },
      } : {}),
    });
  };

  const ensureRightFileSourceWorkspaceVisible = (file: RightWorkspaceFileTab) => {
    const sourceStore = getWorkspaceStore(file.ref.workspaceTabId);
    if (!useTabManagerStore.getState().tabs.some((tab) => tab.id === file.ref.workspaceTabId)) {
      const source = file.ref.source;
      createWorkspaceTab({
        id: file.ref.workspaceTabId,
        kind: source?.kind || (sourceStore.getState().remoteSession ? 'remote' : 'local'),
        workspacePath: sourceStore.getState().currentDir || source?.workspacePath,
        remoteHost: source?.remoteHost,
        label: source?.label,
        workspaceId: source?.workspaceId,
      });
    }
    return sourceStore;
  };

  const moveRightFileToMain = (file: RightWorkspaceFileTab) => {
    if (window.hulala?.kind === 'browser' && file.ref.workspaceTabId !== activeTabId) {
      const context = browserContext(file.ref.workspaceTabId);
      if (context) window.open('/w/' + context.workspace.id, '_blank', 'noopener');
      return;
    }
    const sourceStore = ensureRightFileSourceWorkspaceVisible(file);
    sourceStore.getState().moveTabToPane(file.ref.tabId, 'main');
    removeRightFile(file.ref);
    setSidePanelStatusOpen(false);
    setActiveWorkspaceTab(file.ref.workspaceTabId);
    sourceStore.getState().setActiveTab(file.ref.tabId, { focusEditor: true });
  };

  const closeRightFile = (file: RightWorkspaceFileTab) => {
    if (window.hulala?.kind === 'browser' && file.ref.workspaceTabId !== activeTabId) {
      if (file.document.isDirty) { setClosingReference(file); return; }
      getWorkspaceStore(file.ref.workspaceTabId).getState().closeTab(file.ref.tabId);
      removeRightFile(file.ref);
      return;
    }
    const sourceStore = file.document.isDirty
      ? ensureRightFileSourceWorkspaceVisible(file)
      : getWorkspaceStore(file.ref.workspaceTabId);
    if (file.document.isDirty) {
      setActiveWorkspaceTab(file.ref.workspaceTabId);
    }
    sourceStore.getState().closeTab(file.ref.tabId, { focusEditor: false });
    if (!file.document.isDirty) {
      removeRightFile(file.ref);
      queueMicrotask(() => { void disposeRetainedWorkspaceIfUnused(file.ref.workspaceTabId); });
      if (rightFileTabs.length <= 1 && !outlineTabOpen && !activityPanelPinnedRight) {
        setSidePanelStatusOpen(false);
      }
    }
  };

  const selectRightWorkspaceTab = (key: Parameters<typeof selectRightTab>[0]) => {
    const file = rightFileTabs.find((candidate) => rightWorkspaceFileKey(candidate.ref) === key);
    if (file) {
      getWorkspaceStore(file.ref.workspaceTabId).getState().setActiveTab(file.ref.tabId);
    }
    selectRightTab(key);
  };

  const getPinnedFilePanelWidthLimit = () => {
    const sourceWidth = editorContentRowRef.current?.clientWidth
      || editorAreaRef.current?.clientWidth
      || window.innerWidth;
    return Math.max(
      PINNED_FILE_PANEL_MIN_WIDTH,
      Math.min(PINNED_FILE_PANEL_MAX_WIDTH, sourceWidth - PINNED_FILE_PANEL_PRIMARY_MIN_WIDTH),
    );
  };

  const clampPinnedFilePanelWidth = (width: number) => {
    return Math.min(getPinnedFilePanelWidthLimit(), Math.max(PINNED_FILE_PANEL_MIN_WIDTH, width));
  };

  const renderedPinnedFilePanelWidth = clampPinnedFilePanelWidth(pinnedFilePanelWidth);

  const renderEditorForTab = (
    tab: typeof workspaceDocuments[number] | null,
    options?: {
      pane?: 'main' | 'right';
      autoFocus?: boolean;
    },
  ) => {
    if (!tab) {
      return null;
    }
    const pane = options?.pane ?? 'main';
    const isRightPane = pane === 'right';
    const isMarkdown = tab.editorId === 'markdown';
    if (tab.editorId === 'commands') return <CommandsEditor />;
    if (tab.editorId.startsWith('plugin:')) return <LocalPluginView viewKey={tab.editorId.slice(7)} />;
    if (tab.editorId.startsWith('cron-task:')) {
      return <CronTaskEditor />;
    }
    const editorDef = editorRegistry.get(tab.editorId);
    const EditorComponent = editorDef?.component || TextEditor;
    if (isMarkdown) {
      return (
        <MarkdownEditor
          tabId={tab.id}
          autoFocus={options?.autoFocus ?? false}
          outlinePinEnabled={!isRightPane && Boolean(tab.filePath)}
          outlinePinned={false}
          onOutlinePinToggle={!isRightPane ? () => moveFileToRightWorkspace(tab.id) : undefined}
          outlineToggleEnabled={true}
          outlineMode="popover"
          textOffsetEnabled={true}
          compact={false}
        />
      );
    }
    if (tab.editorId === 'text') {
      return (
        <TextEditor
          tabId={tab.id}
          autoFocus={options?.autoFocus ?? false}
          pinEnabled={false}
        />
      );
    }
    if (tab.editorId === 'excalidraw') {
      return <DrawingEditor tabId={tab.id} autoFocus={options?.autoFocus ?? false} />;
    }
    if (tab.editorId === 'image') {
      return <ImageEditor tabId={tab.id} />;
    }
    if (tab.editorId === 'book' || tab.editorId === 'pdf') {
      return (
        <BookReaderEditor
          tabId={tab.id}
          outlineMode="popover"
          onMoveToRight={!isRightPane ? () => moveFileToRightWorkspace(tab.id) : undefined}
        />
      );
    }
    if (tab.editorId === 'word') {
      return <WordEditor tabId={tab.id} />;
    }
    if (tab.editorId === 'welcome') {
      return <WelcomeEditor />;
    }
    return <EditorComponent />;
  };

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sidebarResizeRef.current) {
      return;
    }
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
      currentWidth: sidebarWidth,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = sidebarResizeRef.current;
      if (!drag) {
        return;
      }
      const deltaX = moveEvent.clientX - drag.startX;
      const nextWidth = clampSidebarWidth(drag.startWidth + deltaX);
      drag.currentWidth = nextWidth;
      setSidebarWidth(nextWidth);
    };

    const cleanup = () => {
      const drag = sidebarResizeRef.current;
      sidebarResizeRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);

      if (!drag) {
        return;
      }
      const finalWidth = clampSidebarWidth(drag.currentWidth);
      if (finalWidth === drag.startWidth) {
        return;
      }
      const persistPromise = window.hulala?.settings?.set?.({
        ui: {
          sidebarWidth: finalWidth,
        },
      });
      if (!persistPromise) {
        return;
      }
      void persistPromise.catch((error) => {
        console.warn('[sidebarWidth] failed to persist:', error);
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const handlePinnedFilePanelResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (pinnedFilePanelResizeRef.current) {
      return;
    }
    pinnedFilePanelResizeRef.current = {
      startX: event.clientX,
      startWidth: renderedPinnedFilePanelWidth,
      currentWidth: renderedPinnedFilePanelWidth,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = pinnedFilePanelResizeRef.current;
      if (!drag) {
        return;
      }
      const deltaX = drag.startX - moveEvent.clientX;
      const nextWidth = clampPinnedFilePanelWidth(drag.startWidth + deltaX);
      drag.currentWidth = nextWidth;
      setPinnedFilePanelWidth(nextWidth);
    };

    const cleanup = () => {
      const drag = pinnedFilePanelResizeRef.current;
      pinnedFilePanelResizeRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);

      if (!drag) {
        return;
      }
      const finalWidth = normalizePinnedFilePanelWidth(drag.currentWidth);
      if (finalWidth === drag.startWidth) {
        setPinnedFilePanelWidth(finalWidth);
        return;
      }
      setPinnedFilePanelWidth(finalWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  useEffect(() => {
    const settingsApi = window.hulala?.settings;
    if (!settingsApi?.get) return;
    let disposed = false;
    const applyUiSettings = (settings?: UiSettingsSnapshot) => {
      if (disposed || sidebarResizeRef.current || pinnedFilePanelResizeRef.current) return;
      setSidebarWidth(resolveSidebarWidth(settings?.ui?.sidebarWidth));
    };
    void settingsApi.get().then((settings) => applyUiSettings(settings as UiSettingsSnapshot));
    const unsubscribe = settingsApi.onChanged?.((settings) => applyUiSettings(settings as UiSettingsSnapshot));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!appInitialized) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempts = 0;
    const sync = async () => {
      attempts += 1;
      try {
        await syncHarnessPresentation(
          desktopThemeScheme === 'dark' ? 'dark' : 'light',
          i18n.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
        );
      } catch {
        if (!cancelled && attempts < 3) {
          retryTimer = window.setTimeout(() => { void sync(); }, 1_500);
        }
      }
    };
    void sync();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [appInitialized, desktopThemeScheme, i18n.language]);

  // Initialize connection and default directory
  useEffect(() => {
    registerBuiltInEditors();
    let mounted = true;
    const revealApp = () => {
      if (mounted) {
        setAppInitialized(true);
      }
    };
    const bootstrapRenderTimeout = window.setTimeout(() => {
      console.warn('Timed out waiting for desktop bootstrap; showing the local workspace shell.');
      revealApp();
    }, APP_BOOTSTRAP_RENDER_TIMEOUT_MS);

    const init = async () => {
      try {
        const bootstrap = await window.hulala?.window?.getBootstrap();
        if (!mounted) {
          return;
        }
        window.clearTimeout(bootstrapRenderTimeout);
        if (bootstrap) {
          setCurrentWindowId(bootstrap.windowId);
        }
        setLocalRuntimeEndpoint('local');
        if (bootstrap?.info) {
          setWindowActive(document.hasFocus() || bootstrap.info.active !== false);
        }

        const bootstrapPresentation = bootstrap?.info?.presentation ?? 'default';
        const shouldShowNewWindowLanding = bootstrapPresentation === 'newWindowLanding';
        setIsNewWindowLanding(shouldShowNewWindowLanding);
        revealApp();

        const restoredSession = bootstrap?.workspaceTabsSession;
        const initialWorkspace = bootstrap?.initialWorkspace;
        if (!shouldShowNewWindowLanding) {
          if (restoredSession?.tabs?.length) {
            await restoreWorkspaceTabsSession(restoredSession);
          } else {
            const currentActiveTabId = useTabManagerStore.getState().activeTabId;
            const store = getWorkspaceStore(currentActiveTabId);
            const state = store.getState();
            if (initialWorkspace?.mode === 'remote' && initialWorkspace.remoteHost) {
              const session = await connectRemoteForTab(currentActiveTabId, initialWorkspace.remoteHost);
              if (session?.workspaceDir) {
                useTabManagerStore.getState().updateActiveTabWorkspace({
                  kind: 'remote',
                  remoteHost: initialWorkspace.remoteHost,
                  workspacePath: session.workspaceDir,
                  label: session.hostLabel,
                });
                state.setCurrentDir(session.workspaceDir);
                await state.ensureDirectory(session.workspaceDir);
              }
            } else {
              state.connect();
              if (initialWorkspace?.workspacePath) {
                useTabManagerStore.getState().updateActiveTabWorkspace({ kind: 'local', workspacePath: initialWorkspace.workspacePath });
                state.setCurrentDir(initialWorkspace.workspacePath);
              }
            }
          }
        } else {
          const landingTabId = useTabManagerStore.getState().activeTabId;
          getWorkspaceStore(landingTabId).getState().connect();
        }

        if (!shouldShowNewWindowLanding && !restoredSession?.tabs?.length && window.hulala?.remote) {
          const currentActiveTabId = useTabManagerStore.getState().activeTabId;
          const currentActiveTab = useTabManagerStore.getState().tabs.find((tab) => tab.id === currentActiveTabId) || null;
          const currentStore = getWorkspaceStore(currentActiveTabId);
          if (!currentStore.getState().remoteSession) {
            const status = await window.hulala.remote.status(currentActiveTabId);
            if (status) {
              const restoredPath = bootstrap?.info?.workspacePath || currentActiveTab?.workspacePath || status.workspaceDir;
              currentStore.getState().setRemoteSession(status);
              currentStore.getState().setCurrentDir(restoredPath);
              useTabManagerStore.getState().updateActiveTabWorkspace({
                kind: 'remote',
                remoteHost: bootstrap?.info?.remoteHost,
                workspacePath: restoredPath,
                label: status.hostLabel,
              });
              currentStore.getState().connect();
              await currentStore.getState().ensureDirectory(restoredPath);
            }
          }
        }

        if (!shouldShowNewWindowLanding && window.hulala?.kind === 'browser') {
          await restoreBrowserReferences();
          referencesRestored.current = true;
        }
        sessionSyncReadyRef.current = !shouldShowNewWindowLanding;
        if (!shouldShowNewWindowLanding) {
          scheduleWorkspaceTabsSessionSync();
        }

        if (!shouldShowNewWindowLanding) {
          const currentActiveTabId = useTabManagerStore.getState().activeTabId;
          const state = getWorkspaceStore(currentActiveTabId).getState();
          if (state.documents.length === 0) state.openWelcomeTab();
        }

        const currentActiveTabId = useTabManagerStore.getState().activeTabId;
        if (bootstrap && bootstrap.info && bootstrap.info.active === false) {
          setWorkspaceActive(currentActiveTabId, false);
        } else {
          setWorkspaceActive(currentActiveTabId, true);
        }
      } catch (error) {
        window.clearTimeout(bootstrapRenderTimeout);
        console.error('Failed to initialize app:', error);
        revealApp();
      }
    };

    void init();
    return () => {
      mounted = false;
      window.clearTimeout(bootstrapRenderTimeout);
      sessionSyncReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!window.hulala?.window?.onActiveChanged) {
      return;
    }
    return window.hulala.window.onActiveChanged(({ active }) => {
      setWindowActive(active);
      if (active) {
        setWorkspaceActive(activeTabId, true);
      } else {
        const { tabs } = useTabManagerStore.getState();
        tabs.forEach((tab) => setWorkspaceActive(tab.id, false));
      }
    });
  }, [activeTabId, currentWindowId]);

  useEffect(() => {
    const previousTabId = prevActiveTabRef.current;
    if (previousTabId && previousTabId !== activeTabId) {
      setWorkspaceActive(previousTabId, false);
    }
    if (windowActive) {
      setWorkspaceActive(activeTabId, true);
    }
    prevActiveTabRef.current = activeTabId;
  }, [activeTabId, windowActive]);

  useEffect(() => {
    const unsubscribeTabs = useTabManagerStore.subscribe(() => {
      scheduleWorkspaceTabsSessionSync();
    });
    return () => {
      unsubscribeTabs();
    };
  }, []);

  useEffect(() => {
    const unsubscribers = workspaceTabs.map((tab) => {
      const workspaceStore = getWorkspaceStore(tab.id);
      const unsubscribeWorkspace = workspaceStore.subscribe((state, previous) => {
        if (state.currentDir !== previous.currentDir || state.documents !== previous.documents || state.activeTabId !== previous.activeTabId) {
          scheduleWorkspaceTabsSessionSync();
        }
      });
      return () => {
        unsubscribeWorkspace();
      };
    });
    scheduleWorkspaceTabsSessionSync();
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [workspaceTabs.map((tab) => tab.id).join('|')]);

  const handleRemoteSelect = async (host: SshHost) => {
    setShowRemoteModal(false);
    if (remoteModalTarget === 'createWorkspace') {
      setCreateWorkspaceRemoteHost(host);
      setCreateWorkspaceError(null);
      setCreateWorkspaceOpen(true);
      return;
    }
    if (remoteModalTarget === 'newWindow') {
      await window.hulala?.window?.createRemote(host);
      return;
    }
    if (remoteModalTarget === 'newTab') {
      await handleNewTabWithRemote(host);
      return;
    }
    if (isNewWindowLanding) {
      await handleSwitchRemoteWorkspace(host);
      await completeNewWindowLanding();
      return;
    }
    await handleSwitchRemoteWorkspace(host);
  };

  const directoryPickerDialog = (
    <DirectoryPickerDialog
      open={!!directoryPickerRequest}
      title={directoryPickerConfig?.title || 'Select Directory'}
      subtitle={directoryPickerConfig?.subtitle || null}
      defaultPath={directoryPickerConfig?.defaultPath || null}
      currentPath={directoryPickerConfig?.currentPath || null}
      recentPaths={directoryPickerConfig?.recentPaths || []}
      submitLabel={directoryPickerConfig?.submitLabel || 'OK'}
      allowCreate
      provider={directoryPickerConfig?.provider || null}
      onClose={closeDirectoryPicker}
      onSelect={handleDirectoryPickerSelect}
    />
  );

  if (!appInitialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-editor-bg text-editor-fg" role="status" aria-live="polite">
        <span className="text-sm text-secondary-text">Starting Hulala…</span>
      </div>
    );
  }

  if (isNewWindowLanding) {
    return (
      <div className="h-screen w-screen bg-editor-bg text-editor-fg">
        <NewWindowLanding
          openingFolder={openingLandingFolder}
          onOpenFolder={() => {
            void handleLandingOpenFolder();
          }}
          onConnectRemote={handleLandingConnectRemote}
        />
        <RemoteConnectModal
          open={showRemoteModal}
          onClose={handleRemoteModalClose}
          onSelect={handleRemoteSelect}
        />
        {directoryPickerDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-editor-bg text-editor-fg">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className="flex flex-col ui-sidebar shrink-0 overflow-hidden"
          style={{
            width: `${sidebarPanelOpen ? sidebarWidth : SIDEBAR_ACTIVITY_RAIL_WIDTH_PX}px`,
          }}
        >
          <Sidebar
            newWorkspaceAction={
              <WorkspaceMenu
                onCreateWorkspace={handleOpenCreateWorkspace}
                onNewFolder={handleNewFolderTab}
                onNewRemote={handleNewRemoteTab}
                onOpenRecentLocal={handleNewTabWithLocal}
                onOpenRecentRemote={handleNewTabWithRemote}
              />
            }
            workspaceActions={
              <RightWorkspaceToggle
                rightPaneOpen={showRightPane}
                onToggleRightPane={() => {
                  const nextOpen = !showRightPane;
                  if (nextOpen && rightPaneBlockedByUnavailableActivity) {
                    setActivityPanelPinnedRight(false);
                  }
                  setRightPaneOpen(nextOpen);
                  if (!nextOpen) setSidePanelStatusOpen(false);
                }}
              />
            }
            onOpenSettings={() => openUnifiedSettings('general')}
            onOpenConfigFiles={openSettingsWorkspace}
            onSwitchLocal={handleSwitchLocalWorkspace}
            onOpenLocalSwitchDirectory={handleOpenLocalSwitchDirectory}
            onOpenRemoteSwitchDirectory={handleOpenRemoteSwitchDirectory}
          />
        </div>
        {sidebarPanelOpen ? (
          <ResizeDivider
            direction="vertical"
            onResizeStart={handleSidebarResizeStart}
            activeColor="var(--color-brand)"
            restingColor="var(--op-sidebar-resize-divider)"
            hoverDelayMs={RESIZE_DIVIDER_HOVER_DELAY_MS}
          />
        ) : null}

        {/* Editor area */}
        <div className="relative min-w-0 flex-1 flex flex-col overflow-visible" ref={editorAreaRef}>
          <ConversationSurface tabId={activeTabId} currentDir={currentDir || undefined} />
          <div
            className="flex-1 min-h-0 flex overflow-hidden"
            ref={editorContentRowRef}
          >
            <section className="relative min-w-0 flex-1 flex flex-col overflow-hidden" data-editor-pane="main">
              <EditorTabBar
                pane="main"
                onTabDragStateChange={setDraggingEditorTabId}
                onMoveTabToPane={(tabId, pane) => {
                  if (pane === 'right') {
                    moveFileToRightWorkspace(tabId);
                    return;
                  }
                  const rightFile = rightFileTabs.find((file) => file.ref.tabId === tabId);
                  if (rightFile) moveRightFileToMain(rightFile);
                }}
              />
              <div
                className="relative min-h-0 flex-1 overflow-hidden"
                onPointerDownCapture={() => {
                  useAppStore.getState().setFocusedEditorPane('main');
                }}
              >
                <div className="absolute inset-0 flex flex-col overflow-hidden">
                  {primaryEditorTab
                    ? renderEditorForTab(primaryEditorTab, { pane: 'main', autoFocus: true })
                    : <WelcomeEditor />}
                </div>
                {!activityPanelPinnedForCurrentWorkspace ? (
                  <ActivityPanel
                    tabId={activeTabId}
                    onPinToRight={() => setActivityPanelPinnedRight(true)}
                  />
                ) : null}
              </div>
            </section>
            {showRightPane ? (
              <>
                <ResizeDivider
                  direction="vertical"
                  onResizeStart={handlePinnedFilePanelResizeStart}
                  activeColor="var(--color-brand)"
                  hoverDelayMs={RESIZE_DIVIDER_HOVER_DELAY_MS}
                />
                <section
                  className="op-right-editor-pane relative shrink-0 min-w-0 h-full min-h-0 flex flex-col overflow-hidden"
                  ref={rightEditorPaneRef}
                  style={{
                    width: `${renderedPinnedFilePanelWidth}px`,
                  }}
                  data-editor-pane="right"
                >
                  <RightWorkspaceTabBar
                    onAddReference={() => setReferenceDialogOpen(true)}
                    files={rightFileTabs}
                    activeTabKey={rightPaneActiveTabKeyForCurrentWorkspace}
                    outlineOpen={outlineTabOpen}
                    activityPinned={activityPanelPinnedForCurrentWorkspace}
                    onSelect={selectRightWorkspaceTab}
                    onCloseFile={closeRightFile}
                    onMoveFileToMain={moveRightFileToMain}
                    onCloseOutline={closeOutlineInRightPane}
                    onCloseActivity={() => setActivityPanelPinnedRight(false)}
                  />
                  <div
                    className="relative min-h-0 flex-1 overflow-hidden"
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(EDITOR_TAB_DRAG_MIME)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={(event) => {
                      const reference = decodeBrowserReference(event.dataTransfer.getData(BROWSER_REFERENCE_MIME));
                      if (reference) { event.preventDefault(); void pinBrowserReference(reference).catch(error => window.dispatchEvent(new CustomEvent('hulala:notice', { detail: String(error) }))); return; }
                      const tabId = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME).trim();
                      if (!tabId) return;
                      event.preventDefault();
                      moveFileToRightWorkspace(tabId);
                      setDraggingEditorTabId(null);
                    }}
                  >
                    {rightPaneActiveTabKeyForCurrentWorkspace === 'outline' ? (
                      <div
                        className="op-right-pane-outline-host absolute inset-0 overflow-hidden bg-editor-bg"
                      />
                    ) : null}
                    {rightPaneActiveTabKeyForCurrentWorkspace === 'activity' && activityPanelPinnedForCurrentWorkspace ? (
                      <ActivityPanel tabId={activeTabId} docked />
                    ) : null}
                    {rightPaneActiveTabKeyForCurrentWorkspace?.startsWith('file:') && activeRightFile ? (
                      <div className="absolute inset-0 flex flex-col overflow-hidden">
                        <WorkspaceStoreContext.Provider value={getWorkspaceStore(activeRightFile.ref.workspaceTabId)}>
                          {renderEditorForTab(activeRightFile.document, { pane: 'right', autoFocus: true })}
                        </WorkspaceStoreContext.Provider>
                      </div>
                    ) : null}
                    {!rightPaneActiveTabKeyForCurrentWorkspace ? (
                      <div className="absolute inset-0 flex flex-col overflow-hidden">
                        <WelcomeEditor />
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </div>
          {draggingEditorTabId && !showRightPane ? (
            <div
              className="op-right-pane-drop-target"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(EDITOR_TAB_DRAG_MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                const tabId = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME).trim();
                if (!tabId) return;
                event.preventDefault();
                moveFileToRightWorkspace(tabId);
                setDraggingEditorTabId(null);
              }}
            >
              <span>{t('shell:editorPane.dropRight')}</span>
            </div>
          ) : null}
          {composerOpen ? <ConversationComposerDock tabId={activeTabId} currentDir={currentDir || undefined} /> : null}
        </div>
      </div>

      <div className="ui-statusbar flex h-7 items-center gap-3 border-t border-border bg-editor-bg px-3 text-secondary-text">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className={activeStatusConnectionState === 'connected' ? 'text-[#428675]' : 'text-accent'}>
            {getConnectionStateText(activeStatusConnectionState)}
          </span>
          <span
            className="min-w-0 truncate"
            style={{ maxWidth: 'min(48vw, 44rem)' }}
            title={statusBarPathDisplay.fullLabel}
          >
            {statusBarPathDisplay.label}
          </span>
          {activeStatusRemoteSession && (
            <span className="truncate max-w-[24vw]">Remote: {activeStatusRemoteSession.hostLabel}</span>
          )}
          {activeStatusRemoteError && <span className="truncate text-accent">{activeStatusRemoteError}</span>}
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2">
          {window.hulala?.kind === 'browser' ? <BrowserSaveStatus document={activeStatusDocument} compare={path => { void getWorkspaceStore(activeTabId).getState().openFile(path, { pane: 'right', fresh: true }); }} /> : null}
          {showEpubTextZoom ? <EpubReadingProgressStatusControl filePath={activeStatusFilePath} /> : null}
          {showPdfReadingControls ? <PdfReadingProgressStatusControl tabId={activeStatusTabId || ''} /> : null}
          {showMarkdownWordCount ? (
            <span
              className="whitespace-nowrap tabular-nums"
              title={`Markdown document word count: ${markdownWordCountLabel}`}
              aria-label={`Markdown document word count: ${markdownWordCountLabel}`}
            >
              Words {markdownWordCountLabel}
            </span>
          ) : null}
          {activeStatusEditorId === 'markdown' ? <EditorTextZoomStatusControl /> : null}
          {showEpubTextZoom ? <EpubTextZoomStatusControl /> : null}
          {showPdfReadingControls ? <PdfZoomStatusControl tabId={activeStatusTabId || ''} /> : null}
          {canShowRightPanelStatus ? (
            <div className="relative no-drag" ref={sidePanelStatusPopoverRef}>
              <button
                type="button"
                className={`ui-statusbar-control ${sidePanelStatusOpen ? 'text-brand' : ''}`}
                onClick={() => setSidePanelStatusOpen((open) => !open)}
                title="Show side panel status"
                aria-label="Show side panel status"
                aria-haspopup="dialog"
                aria-expanded={sidePanelStatusOpen}
              >
                <SidebarPanelToggleIcon className="h-3.5 w-3.5 rotate-180" />
              </button>
              {sidePanelStatusOpen ? (
                <PopupMenu
                  className="absolute bottom-full right-0 z-[60] mb-2 min-w-[280px] rounded-xl p-2"
                  role="dialog"
                  aria-label="Side panel status"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="px-1 pb-2">
                    <div className="text-[11px] text-tertiary-text">Side panel</div>
                    <div
                      className="mt-0.5 max-w-[360px] truncate text-sm text-prime-text"
                      title={sideStatusPathDisplay.fullLabel}
                    >
                      {sideStatusPathDisplay.label}
                    </div>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center gap-3 px-1 pt-2 text-secondary-text">
                    {sideShowEpubTextZoom ? <EpubReadingProgressStatusControl filePath={sideStatusFilePath} /> : null}
                    {sideShowPdfReadingControls ? <PdfReadingProgressStatusControl tabId={sideStatusDocument?.id || ''} /> : null}
                    {sideShowMarkdownWordCount ? (
                      <span className="whitespace-nowrap tabular-nums">
                        Words {sideMarkdownWordCountLabel}
                      </span>
                    ) : null}
                    {sideShowMarkdownWordCount ? <EditorTextZoomStatusControl /> : null}
                    {sideShowEpubTextZoom ? <EpubTextZoomStatusControl /> : null}
                    {sideShowPdfReadingControls ? <PdfZoomStatusControl tabId={sideStatusDocument?.id || ''} /> : null}
                    {!sideHasDocumentControls ? <span className="whitespace-nowrap">No document status</span> : null}
                  </div>
                </PopupMenu>
              ) : null}
            </div>
          ) : null}
          <BranchStatusControl />
        </div>
      </div>

      <RemoteConnectModal
        open={showRemoteModal}
        onClose={handleRemoteModalClose}
        onSelect={handleRemoteSelect}
      />

      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        name={createWorkspaceName}
        remoteHost={createWorkspaceRemoteHost}
        busy={createWorkspaceBusy}
        error={createWorkspaceError}
        onNameChange={(name) => {
          setCreateWorkspaceName(name);
          setCreateWorkspaceError(null);
        }}
        onCancel={() => setCreateWorkspaceOpen(false)}
        onSubmit={() => { void handleCreateManagedWorkspace(); }}
        onConnectRemote={handleCreateWorkspaceConnectRemote}
        onUseLocal={() => {
          setCreateWorkspaceRemoteHost(null);
          setCreateWorkspaceError(null);
        }}
      />

      {directoryPickerDialog}
      <BrowserReferenceDialog open={referenceDialogOpen} close={() => setReferenceDialogOpen(false)} />
      <UnsavedTabCloseDialog open={Boolean(closingReference)} tabTitle={closingReference?.document.title || null} onCancel={() => setClosingReference(null)} onConfirm={() => {
        if (!closingReference) return;
        const state = getWorkspaceStore(closingReference.ref.workspaceTabId).getState();
        state.closeTab(closingReference.ref.tabId);
        state.confirmPendingDirtyTabClose();
        removeRightFile(closingReference.ref);
        setClosingReference(null);
      }} />

      <DirectoryPickerDialog
        open={!!saveFileRequest}
        mode="saveFile"
        title="Save File"
        defaultPath={saveFileRequest?.defaultDir || currentDir || null}
        defaultFileName={saveFileRequest?.defaultFileName || ''}
        filters={saveFileRequest?.filters}
        submitLabel="Save"
        allowCreate
        provider={saveFileProvider}
        onClose={() => resolveSaveFileDialog(null)}
        onSelect={async (path) => { resolveSaveFileDialog(path); }}
      />

      <UnsavedTabCloseDialog
        open={!!pendingDirtyTabClose}
        tabTitle={pendingDirtyTabClose?.title || null}
        onCancel={dismissPendingDirtyTabClose}
        onConfirm={confirmPendingDirtyTabClose}
      />

      <UnifiedSettingsModal />

      <ToastViewport />
    </div>
  );
}
