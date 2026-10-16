import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type {
  ConversationCommand,
  ConversationContent,
  ConversationModelSelectionInput,
  ConversationQueueItem,
  ConversationSession,
  ConversationSnapshot,
} from '@hulala/workbench-contracts';
import {
  archiveConversation,
  cancelConversation,
  createConversation,
  executeConversationCommand,
  forkConversation,
  listConversationAgentPresets,
  listConversationCommands,
  loadConversationModels,
  listConversationSkills,
  listConversations,
  openConversation,
  renameConversation,
  selectConversationAgentPreset,
  selectConversationModel,
  sendConversationPrompt,
  updateConversationQueue,
} from '../../services/conversationService';
import { getConversationStore, useConversationStore } from '../../store/conversationStore';
import { useUiStore } from '../../store/uiStore';
import { IconButton } from '../IconButton';
import { getConversationDrafts } from '../../services/conversationDrafts';
import { TAB_ICON_HOVER_LIFT_CLASS } from '../tabLayout';
import { ConversationTabItem } from './ConversationTabItem';
import {
  CheckTinyIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseTinyIcon,
  EditIcon,
  HistoryIcon,
  PlusIcon,
  SendArrowSimpleIcon,
  StopIcon,
  TrashIcon,
} from '../Icons';

const DEFAULT_DOCK_HEIGHT = 160;
const MIN_DOCK_HEIGHT = 120;
const DOCK_LAYOUT_SAFETY_GAP = 220;

type ModelInventory = {
  current: ConversationModelSelectionInput;
  routable: boolean;
  groups: Array<{
    id: string;
    name: string;
    models: Array<{
      id: string;
      name: string;
      description?: string;
      reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string };
    }>;
  }>;
};

type AgentPreset = { id: string; name?: string; description?: string; broken?: string; isDefault?: boolean };
type ImageMediaType = Extract<ConversationContent, { type: 'image' }>['mediaType'];
const isImageMediaType = (value: string): value is ImageMediaType =>
  value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif';
type MenuName = 'history' | 'agent' | 'model' | 'permission' | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionForId(sessions: ConversationSession[], sessionId: string | null): ConversationSession | null {
  return sessionId ? sessions.find((session) => session.sessionId === sessionId) ?? null : null;
}

function textFromContent(content: ConversationContent[]): string {
  return content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
}

function runStatus(session: ConversationSession | null, snapshot: ConversationSnapshot | undefined): 'idle' | 'running' | 'complete' | 'waiting' {
  if (snapshot?.pendingInteractions.length) return 'waiting';
  if (session?.running) return 'running';
  return (snapshot?.items.length || 0) > 0 ? 'complete' : 'idle';
}

function queueSummary(item: ConversationQueueItem): string {
  return textFromContent(item.content).replace(/\s+/g, ' ').trim() || item.placement;
}

function formatHistoryUpdatedAt(updatedAt: number): string {
  if (!Number.isFinite(updatedAt)) return '';
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function ConversationComposerDock({ tabId, currentDir }: { tabId: string; currentDir?: string }) {
  const closeConversation = useUiStore((state) => state.closeConversation);
  const activeSessionId = useConversationStore(tabId, (state) => state.activeSessionId);
  const openSessionIds = useConversationStore(tabId, (state) => state.openSessionIds);
  const sessions = useConversationStore(tabId, (state) => state.sessions);
  const snapshots = useConversationStore(tabId, (state) => state.snapshots);
  const journal = useMemo(() => getConversationDrafts(tabId), [tabId]);
  const draftEntries = useSyncExternalStore(journal.subscribe, journal.snapshot);
  const workspaceKey = useConversationStore(tabId, (state) => state.workspaceKey);
  const store = useMemo(() => getConversationStore(tabId), [tabId]);
  const session = sessionForId(sessions, activeSessionId);
  const snapshot = activeSessionId ? snapshots[activeSessionId] : undefined;
  const currentDraft = activeSessionId ? journal.current(activeSessionId) : undefined;
  const draft = currentDraft?.text || '';
  const images = currentDraft?.images || [];
  const variants = draftEntries.filter(item => item.sessionId === activeSessionId);
  const [height, setHeight] = useState(DEFAULT_DOCK_HEIGHT);
  const [menu, setMenu] = useState<MenuName>(null);
  const [tabMenuSessionId, setTabMenuSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const uploadAbort = useRef<AbortController | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMenuPosition, setHistoryMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const [error, setError] = useState('');
  const [models, setModels] = useState<ModelInventory | null>(null);
  const [commands, setCommands] = useState<ConversationCommand[]>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const workspaceKeyRef = useRef(workspaceKey);
  workspaceKeyRef.current = workspaceKey;
  const requestEpochRef = useRef(0);
  const captureRequestScope = () => {
    const epoch = requestEpochRef.current;
    return () => requestEpochRef.current === epoch;
  };

  useLayoutEffect(() => {
    requestEpochRef.current += 1;
    setBusy(false);
    return () => { requestEpochRef.current += 1; };
  }, [tabId, workspaceKey, activeSessionId]);

  useEffect(() => { void journal.load().catch(reason => setError(messageFor(reason))); }, [journal]);
  useEffect(() => {
    if (!uploading) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [uploading]);

  const minimumHeight = images.length ? 240 : MIN_DOCK_HEIGHT;
  const maxDockHeight = () => Math.max(minimumHeight, window.innerHeight - DOCK_LAYOUT_SAFETY_GAP);
  const pendingInteraction = snapshot?.pendingInteractions[0] ?? null;
  const planProjection = asRecord(snapshot?.projections.values.plan);
  const planActive = planProjection?.active === true || planProjection?.pending === true;
  const permission = asRecord(snapshot?.projections.values.permissions);
  const permissionOptions = Array.isArray(permission?.options)
    ? permission.options.flatMap((entry) => typeof entry === 'string' ? [entry] : typeof asRecord(entry)?.value === 'string' ? [String(asRecord(entry)?.value)] : [])
    : Array.isArray(permission?.presets) ? permission.presets.filter((entry): entry is string => typeof entry === 'string') : [];
  const permissionValue = typeof permission?.currentValue === 'string'
    ? permission.currentValue
    : typeof permission?.current === 'string'
      ? permission.current
      : typeof permission?.preset === 'string' ? permission.preset : '';
  const selectedModel = models?.groups
    .find((group) => group.id === models?.current.provider)
    ?.models.find((model) => model.id === models?.current.model);
  const tabMenuSession = sessionForId(sessions, tabMenuSessionId);
  const historySessions = useMemo(() => sessions
    .filter((item) => !item.archived && item.origin !== 'subagent' && !item.parentSessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId)), [sessions]);
  const slashOptions = useMemo(() => {
    if (!draft.startsWith('/')) return [];
    const query = draft.slice(1).toLowerCase();
    return [...commands, ...skills.filter((skill) => !commands.some((command) => command.name === skill.name))]
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [commands, draft, skills]);
  const pickerElevated = menu !== null || slashOptions.length > 0 || tabMenuSessionId !== null;
  const isCurrentWorkspaceRequest = (requestedWorkspaceKey: string | null) => (
    workspaceKeyRef.current === requestedWorkspaceKey
    && store.getState().workspaceKey === requestedWorkspaceKey
  );

  useEffect(() => {
    let active = true;
    void window.hulala?.settings.get().then((settings) => {
      if (!active) return;
      const ui = asRecord(settings?.ui);
      if (typeof ui?.conversationComposerDockHeight === 'number') {
        setHeight(Math.max(MIN_DOCK_HEIGHT, Math.min(maxDockHeight(), ui.conversationComposerDockHeight)));
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onResize = () => setHeight((current) => Math.min(current, maxDockHeight()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setError('');
    setMenu(null);
    setModels(null);
    setCommands([]);
    setSkills([]);
    setPresets([]);
    if (!session) return;
    let active = true;
    void Promise.all([
      loadConversationModels(tabId, session.sessionId).catch(() => null),
      listConversationCommands(tabId, session.sessionId).catch(() => ({ items: [] })),
      listConversationSkills(tabId, session.sessionId).catch(() => ({ items: [] })),
      listConversationAgentPresets(tabId).catch(() => ({ presets: [] })),
    ]).then(([nextModels, nextCommands, nextSkills, nextPresets]) => {
      if (!active) return;
      setModels(nextModels as ModelInventory | null);
      setCommands(Array.isArray(nextCommands.items) ? nextCommands.items : []);
      setSkills(Array.isArray(nextSkills.items) ? nextSkills.items : []);
      setPresets(nextPresets.presets);
    });
    return () => { active = false; };
  }, [session?.sessionId, tabId]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && popupRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-composer-menu-trigger]:not(:disabled)')) return;
      setMenu(null);
      setTabMenuSessionId(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, []);

  const persistHeight = (next: number) => {
    void window.hulala?.settings.set({ ui: { conversationComposerDockHeight: Math.round(next) } }).catch(() => undefined);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    let currentHeight = startHeight;
    const move = (next: PointerEvent) => {
      currentHeight = Math.max(minimumHeight, Math.min(maxDockHeight(), startHeight - (next.clientY - startY)));
      setHeight(currentHeight);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      persistHeight(currentHeight);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const selectSession = (sessionId: string) => {
    setMenu(null);
    if (store.getState().snapshots[sessionId]) {
      store.getState().selectSession(sessionId);
      return;
    }
    const requestedWorkspaceKey = workspaceKey;
    store.getState().setLoading(true);
    void openConversation(tabId, currentDir, { kind: 'session', sessionId })
      .then((result) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) store.getState().applyOpen(result);
      })
      .catch((reason) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) {
          store.getState().setLoading(false);
          store.getState().setError(messageFor(reason));
        }
      });
  };

  const createSession = () => {
    const requestedWorkspaceKey = workspaceKey;
    store.getState().setLoading(true);
    void createConversation(tabId, currentDir)
      .then((result) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) store.getState().applyOpen(result);
      })
      .catch((reason) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) {
          store.getState().setLoading(false);
          store.getState().setError(messageFor(reason));
        }
      });
  };

  const addImages = async (files: File[]) => {
    if (!session || !journal.ready || uploadLock.current) return;
    const sessionId = session.sessionId;
    const candidates = files.filter(file => isImageMediaType(file.type)).slice(0, 19 - images.length);
    if (!candidates.length) return;
    const isCurrentRequest = captureRequestScope();
    uploadLock.current = true;
    setUploading(true);
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      // Bound peak memory; each completed receipt is recoverable even if a later file fails.
      for (const file of candidates) {
        const mediaType = file.type;
        if (!isImageMediaType(mediaType)) continue;
        controller.signal.throwIfAborted();
        setUploadPercent(0);
        const uploadId = crypto.randomUUID();
        await window.hulala!.desktop.conversation.uploadImage(tabId, sessionId, uploadId, file, file.name, { signal: controller.signal, onProgress: (loaded, total) => setUploadPercent(Math.round(loaded / Math.max(total, 1) * 100)) });
        const current = journal.current(sessionId)?.images || [];
        journal.edit(sessionId, { images: [...current, { uploadId, mediaType, name: file.name }].slice(0, 19) });
      }
    } catch (reason) {
      if (isCurrentRequest()) setError(messageFor(reason));
    } finally { uploadLock.current = false; uploadAbort.current = null; setUploading(false); }
  };

  const submit = async (mode: 'queue' | 'steer' = 'queue') => {
    if (!session || busy || uploading || !journal.ready || !currentDraft || pendingInteraction) return;
    const submitted = { id: currentDraft.id, text: draft, images: [...images] };
    const text = draft.trim();
    if (!text && images.length === 0) return;
    const isCurrentRequest = captureRequestScope();
    const requestedWorkspaceKey = workspaceKey;
    setBusy(true);
    setError('');
    try {
      const slashName = text.match(/^\/([^\s]+)/)?.[1];
      const command = slashName ? commands.find((entry) => entry.name === slashName) : undefined;
      if (command) {
        if (images.length > 0 && command.input?.images !== true) throw new Error(`/${command.name} does not accept images`);
        await executeConversationCommand(tabId, session.sessionId, text, images);
      } else {
        const input = {
          mode,
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images.map((image) => ({ type: 'image' as const, ...image })),
          ],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        const requestId = await journal.prepare(session.sessionId, input);
        await sendConversationPrompt(tabId, session.sessionId, { ...input, requestId });
      }
      if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) {
        await journal.accepted(session.sessionId, submitted);
        store.getState().setActivityExpanded(session.sessionId, true);
      }
    } catch (reason) {
      if (isCurrentRequest()) setError(messageFor(reason));
    } finally {
      if (isCurrentRequest()) setBusy(false);
    }
  };

  const selectModel = (provider: string, model: string, reasoningEffort?: string) => {
    if (!session) return;
    const isCurrentRequest = captureRequestScope();
    setError('');
    void selectConversationModel(tabId, session.sessionId, { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
      .then(() => loadConversationModels(tabId, session.sessionId))
      .then((value) => { if (isCurrentRequest()) setModels(value as ModelInventory); })
      .catch((reason) => { if (isCurrentRequest()) setError(messageFor(reason)); });
  };

  const toggleMenu = (nextMenu: Exclude<MenuName, null>) => {
    setTabMenuSessionId(null);
    setMenu((current) => current === nextMenu ? null : nextMenu);
  };

  const toggleHistory = () => {
    setTabMenuSessionId(null);
    if (menu === 'history') {
      setMenu(null);
      setHistoryMenuPosition(null);
      return;
    }
    const buttonBounds = historyButtonRef.current?.getBoundingClientRect();
    setHistoryMenuPosition(buttonBounds ? {
      left: Math.max(8, Math.min(buttonBounds.left, window.innerWidth - 288)),
      bottom: Math.max(8, window.innerHeight - buttonBounds.top + 4),
    } : null);
    setMenu('history');
    const requestedWorkspaceKey = workspaceKey;
    setHistoryLoading(true);
    void listConversations(tabId, currentDir)
      .then((result) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) {
          store.getState().setSessions(result.items);
        }
      })
      .catch((reason) => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) setError(messageFor(reason));
      })
      .finally(() => {
        if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) setHistoryLoading(false);
      });
  };

  const selectPreset = (agentPreset: string) => {
    if (!session?.blank) return;
    setError('');
    void selectConversationAgentPreset(tabId, session.sessionId, agentPreset)
      .then(() => listConversations(tabId, currentDir))
      .then((result) => store.getState().setSessions(result.items))
      .then(() => setMenu(null))
      .catch((reason) => setError(messageFor(reason)));
  };

  const updatePermission = (value: string) => {
    if (!session || !value) return;
    setMenu(null);
    void executeConversationCommand(tabId, session.sessionId, `/permission ${value}`)
      .catch((reason) => setError(messageFor(reason)));
  };

  const runTabAction = (action: 'rename' | 'fork' | 'archive') => {
    const target = tabMenuSession;
    setTabMenuSessionId(null);
    if (!target) return;
    if (action === 'rename') {
      const title = window.prompt('Rename chat', target.title)?.trim();
      if (!title) return;
      void renameConversation(tabId, target.sessionId, title)
        .then(() => listConversations(tabId, currentDir))
        .then((result) => store.getState().setSessions(result.items))
        .catch((reason) => setError(messageFor(reason)));
      return;
    }
    if (action === 'fork') {
      const requestedWorkspaceKey = workspaceKey;
      void forkConversation(tabId, target.sessionId, snapshots[target.sessionId]?.lastSeq >= 0 ? snapshots[target.sessionId].lastSeq : undefined)
        .then((result) => openConversation(tabId, currentDir, { kind: 'session', sessionId: result.sessionId }))
        .then((result) => {
          if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) store.getState().applyOpen(result);
        })
        .catch((reason) => {
          if (isCurrentWorkspaceRequest(requestedWorkspaceKey)) setError(messageFor(reason));
        });
      return;
    }
    void archiveConversation(tabId, target.sessionId)
      .then(() => store.getState().removeSession(target.sessionId))
      .catch((reason) => setError(messageFor(reason)));
  };

  const commandPlaceholder = session?.running ? 'Queue a follow-up · Cmd/Ctrl+Enter to steer' : 'Send a message…';
  const hasActionableDraft = Boolean(draft.trim() || images.length > 0);
  const primaryStopsRun = Boolean(session?.running && !hasActionableDraft);
  const primaryActionLabel = primaryStopsRun ? 'Stop' : session?.running ? 'Queue' : 'Send';
  const modelLabel = selectedModel?.name || (models ? `${models.current.provider}/${models.current.model}` : 'Select model');
  const currentPreset = presets.find((preset) => preset.id === session?.agentPreset)
    || presets.find((preset) => preset.isDefault);
  const historyControl = (
    <div className="hulala-composer-leading-column hulala-composer-history-control">
      <IconButton
        ref={historyButtonRef}
        variant="inline"
        size={24}
        className={`${TAB_ICON_HOVER_LIFT_CLASS} text-secondary-text`}
        data-composer-menu-trigger=""
        onClick={toggleHistory}
        title="Chat history for this workspace"
        aria-label="Chat history for this workspace"
        aria-expanded={menu === 'history'}
      >
        <HistoryIcon className="h-[17px] w-[17px]" />
      </IconButton>
      {menu === 'history' && historyMenuPosition ? createPortal(
        <div
          ref={popupRef}
          className="hulala-composer-menu is-history"
          aria-label="Workspace chat history"
          style={{
            position: 'fixed',
            top: 'auto',
            left: historyMenuPosition.left,
            bottom: historyMenuPosition.bottom,
            width: 280,
            zIndex: 9999,
          }}
        >
          {historyLoading ? <span>Refreshing history…</span> : null}
          {historySessions.map((item) => (
            <button
              type="button"
              key={item.sessionId}
              className={item.sessionId === activeSessionId ? 'is-selected' : ''}
              onClick={() => selectSession(item.sessionId)}
              title={item.title || item.sessionId}
            >
              <span className="hulala-composer-picker-check">
                {item.sessionId === activeSessionId ? <CheckTinyIcon /> : null}
              </span>
              <span className="hulala-composer-picker-copy">
                <span className="hulala-composer-picker-name">{item.title || 'New Chat'}</span>
                <span className="hulala-composer-picker-description">
                  {formatHistoryUpdatedAt(item.updatedAt)}{item.running ? ' · Running' : ''}
                </span>
              </span>
            </button>
          ))}
          {!historyLoading && historySessions.length === 0 ? <span>No chat history in this workspace</span> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );

  return (
    <section
      className={`hulala-composer-dock ${pickerElevated ? 'is-elevated' : ''}`}
      style={{ height: Math.max(height, minimumHeight) }}
      aria-label="Conversation composer"
    >
      <div className="hulala-composer-resize" onPointerDown={startResize} />
      <header className="flex h-10 shrink-0 items-center px-2 overflow-visible">
        <div className="hulala-composer-leading-column items-center">
          <IconButton variant="inline" className="group relative" onClick={closeConversation} title="Close composer dock" aria-label="Close composer dock">
            <span className="absolute h-2.5 w-2.5 rounded-full bg-tertiary-text opacity-50 transition-opacity duration-150 group-hover:opacity-0" />
            <svg className="w-3.5 h-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </IconButton>
        </div>
        <div className="ui-tabbar flex min-w-0 items-center">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden pr-2">
            {openSessionIds.map((sessionId) => {
              const item = sessionForId(sessions, sessionId);
              if (!item) return null;
              return <ConversationTabItem
                key={item.sessionId}
                title={item.title || 'New Chat'}
                buttonTitle={item.title || item.sessionId}
                closeLabel={`Close ${item.title || 'New Chat'}`}
                isSelected={item.sessionId === activeSessionId}
                status={runStatus(item, snapshots[item.sessionId])}
                onSelect={() => selectSession(item.sessionId)}
                onClose={(event) => { event.stopPropagation(); store.getState().closeSession(item.sessionId); }}
                onContextMenu={(event) => { event.preventDefault(); setMenu(null); setTabMenuSessionId(item.sessionId); }}
              />;
            })}
          </div>
          <div className="ml-1 shrink-0">
            <IconButton variant="inline" size={20} className={`${TAB_ICON_HOVER_LIFT_CLASS} text-secondary-text`} onClick={createSession} title="New Chat" aria-label="New Chat"><PlusIcon className="w-3.5 h-3.5" /></IconButton>
          </div>
          {tabMenuSessionId ? (
            <div ref={popupRef} className="hulala-composer-menu is-tab-menu">
              <button type="button" onClick={() => runTabAction('rename')}><EditIcon className="h-3.5 w-3.5" />Rename</button>
              <button type="button" onClick={() => runTabAction('fork')}><PlusIcon className="h-3.5 w-3.5" />Fork</button>
              <button type="button" className="is-danger" onClick={() => runTabAction('archive')}><TrashIcon className="h-3.5 w-3.5" />Archive</button>
            </div>
          ) : null}
        </div>
        <div className="flex-1 min-w-0" />
      </header>

      <div className="hulala-composer-content">
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addImages(files); }} />
        <div className="hulala-composer-leading-column" aria-hidden="true" />
        <div className="hulala-composer-editor-column">
          <div className="hulala-composer-scroll">
            {draftEntries.some(item => item.sessionId !== activeSessionId && (item.text || item.images.length)) ? <label>Saved drafts <select value="" onChange={event => { const item = draftEntries.find(draft => draft.id === event.target.value); if (item) { journal.select(item.sessionId, item.id); selectSession(item.sessionId); } }}><option value="">Choose a conversation draft…</option>{draftEntries.filter(item => item.text || item.images.length).map(item => <option key={item.id} value={item.id}>{sessions.find(session => session.sessionId === item.sessionId)?.title || 'Chat'}: {item.text.slice(0, 40) || 'Images'}</option>)}</select></label> : null}
            {uploading ? <div role="status">Uploading images… {uploadPercent}% <button type="button" onClick={() => uploadAbort.current?.abort()}>Cancel</button></div> : null}
            {variants.length > 1 ? <label>Recovered draft <select value={currentDraft?.id} onChange={event => activeSessionId && journal.select(activeSessionId, event.target.value)}>{variants.map((item, index) => <option key={item.id} value={item.id}>{index + 1}: {item.text.slice(0, 40) || 'Images'}</option>)}</select></label> : null}
            {planActive ? <button type="button" className="hulala-composer-resource" onClick={() => session && void executeConversationCommand(tabId, session.sessionId, '/plan off').catch((reason) => setError(messageFor(reason)))}>Plan <CloseTinyIcon /></button> : null}
            {images.length > 0 ? <div className="hulala-composer-images">{images.map((image, index) => <span key={`${image.name || 'image'}:${index}`}><img src={window.hulala!.desktop.conversation.imageUploadUrl(tabId, activeSessionId!, image.uploadId)} alt={image.name || 'Attachment'} /><button type="button" aria-label={`Remove ${image.name || 'image'}`} onClick={() => activeSessionId && journal.edit(activeSessionId, { images: images.filter((_, position) => position !== index) })}><CloseTinyIcon /></button></span>)}</div> : null}
            <div className="hulala-composer-input-wrap">
              <textarea
                value={draft}
                disabled={!session || !journal.ready || Boolean(pendingInteraction)}
                placeholder={pendingInteraction ? 'Answer the question in the conversation above…' : commandPlaceholder}
                onChange={(event) => activeSessionId && journal.edit(activeSessionId, { text: event.target.value })}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length > 0) { event.preventDefault(); void addImages(files); }
                }}
                onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)); }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
                  event.preventDefault();
                  void submit(session?.running && (event.metaKey || event.ctrlKey) ? 'steer' : 'queue');
                }}
              />
              {slashOptions.length > 0 ? <div className="hulala-composer-slash-menu">{slashOptions.map((option) => <button type="button" key={option.name} onClick={() => activeSessionId && journal.edit(activeSessionId, { text: `/${option.name} ` })}><strong>/{option.name}</strong><span>{option.description}</span></button>)}</div> : null}
            </div>
          </div>
        </div>
        {snapshot?.queue.length ? (
          <aside className="hulala-conversation-queued-rail" aria-label="Queued messages">
            <div>Queued {snapshot.queue.length}</div>
            {snapshot.queue.map((item) => <div key={item.id} className="hulala-conversation-queued-item"><span>{queueSummary(item)}</span><button type="button" title={item.content.some(part => part.type !== 'text') ? 'Image messages cannot be edited in the queue; remove and resend to change them' : 'Edit queued message'} disabled={item.content.some(part => part.type !== 'text')} onClick={() => {
              const value = window.prompt('Edit queued message', queueSummary(item))?.trim();
              if (value && session) void updateConversationQueue(tabId, session.sessionId, item.id, { kind: 'edit', content: [{ type: 'text', text: value }] }).catch(reason => setError(messageFor(reason)));
            }}><EditIcon className="h-3 w-3" /></button><button type="button" title="Steer next" onClick={() => session && void updateConversationQueue(tabId, session.sessionId, item.id, { kind: 'steer' })}><ChevronRightIcon className="h-3 w-3" /></button><button type="button" title="Delete queued message" onClick={() => session && void updateConversationQueue(tabId, session.sessionId, item.id, { kind: 'remove' })}><TrashIcon className="h-3 w-3" /></button></div>)}
          </aside>
        ) : null}
      </div>

      <footer className="hulala-composer-toolbar">
        {historyControl}
        <div className="hulala-composer-toolbar-controls">
          {permissionOptions.length > 0 ? <div className="hulala-composer-picker"><button type="button" data-composer-menu-trigger="" onClick={() => toggleMenu('permission')}>{permissionValue.replaceAll('-', ' ') || 'Permissions'}<ChevronDownIcon className="h-3 w-3" /></button>{menu === 'permission' ? <div ref={popupRef} className="hulala-composer-menu is-picker">{permissionOptions.map((option) => <button type="button" key={option} className={option === permissionValue ? 'is-selected' : ''} onClick={() => updatePermission(option)}>{option.replaceAll('-', ' ')}</button>)}</div> : null}</div> : null}
          <div className="hulala-composer-picker"><button type="button" data-composer-menu-trigger="" disabled={!session?.blank} title={session?.blank ? 'Select agent preset' : 'Agent preset is locked after the first turn'} onClick={() => toggleMenu('agent')}><span>{currentPreset?.name || currentPreset?.id || 'Default agent'}</span><ChevronDownIcon className="h-3 w-3" /></button>{menu === 'agent' ? <div ref={popupRef} className="hulala-composer-menu is-picker is-agent-picker">{presets.filter((preset) => !preset.broken).map((preset) => {
            const selected = preset.id === session?.agentPreset || (!session?.agentPreset && preset.isDefault === true);
            return <button type="button" key={preset.id} className={selected ? 'is-selected' : ''} onClick={() => selectPreset(preset.id)}>
              <span className="hulala-composer-picker-check">{selected ? <CheckTinyIcon /> : null}</span>
              <span className="hulala-composer-picker-copy"><span className="hulala-composer-picker-name">{preset.name || preset.id}</span><span className="hulala-composer-picker-description">{preset.description || preset.id}</span></span>
            </button>;
          })}</div> : null}</div>
          <div className="hulala-composer-picker"><button type="button" data-composer-menu-trigger="" onClick={() => toggleMenu('model')}><span>{modelLabel}</span><ChevronDownIcon className="h-3 w-3" /></button>{menu === 'model' ? <div ref={popupRef} className="hulala-composer-menu is-model">{models?.groups.flatMap((group) => group.models.map((model) => {
            const selected = group.id === models.current.provider && model.id === models.current.model;
            return <div key={`${group.id}/${model.id}`} className="hulala-model-menu-row"><button type="button" className={selected ? 'is-selected' : ''} onClick={() => { selectModel(group.id, model.id, model.reasoning?.defaultEffort); setMenu(null); }}><span>{selected ? <CheckTinyIcon /> : null}</span><span><strong>{model.name}</strong>{model.description ? <small>{model.description}</small> : null}</span></button>{selected && model.reasoning?.efforts.length ? <div className="hulala-model-efforts">{model.reasoning.efforts.map((effort) => <button type="button" key={effort.id} className={models.current.reasoningEffort === effort.id ? 'is-selected' : ''} onClick={() => selectModel(group.id, model.id, effort.id)}>{effort.name}</button>)}</div> : null}</div>;
          })) || <span>No models available</span>}</div> : null}</div>
        </div>
        <div className="hulala-composer-primary-actions">
          <button
            type="button"
            className="hulala-composer-icon-button is-attachment"
            disabled={!session || !journal.ready || Boolean(pendingInteraction)}
            onClick={() => imageInputRef.current?.click()}
            title={uploading ? 'Uploading images…' : 'Add images'}
            aria-label="Add images"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="hulala-composer-icon-button is-submit"
            disabled={!session || !journal.ready || busy || uploading || Boolean(pendingInteraction)}
            onClick={() => primaryStopsRun && session
              ? void cancelConversation(tabId, session.sessionId)
              : void submit('queue')}
            title={primaryActionLabel}
            aria-label={primaryActionLabel}
          >
            {primaryStopsRun ? <StopIcon className="h-4 w-4" /> : <SendArrowSimpleIcon className="h-[17px] w-[17px]" />}
          </button>
        </div>
        {error || journal.failure ? <span role="alert" className="hulala-composer-error">{error || journal.failure}</span> : null}
      </footer>
    </section>
  );
}
