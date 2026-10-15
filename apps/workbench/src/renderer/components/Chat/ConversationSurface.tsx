import { sessionStore } from "../../../platform/storage";
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { listConversations, loadConversationHistory, openConversation } from '../../services/conversationService';
import { conversationWorkspaceKey, getConversationStore } from '../../store/conversationStore';
import { useTabManagerStore } from '../../store/tabManagerStore';
import { useUiStore } from '../../store/uiStore';

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps the native Harness conversation store synchronized with the active
 * workspace. Presentation intentionally lives in ActivityPanel and
 * ConversationComposerDock so they can be laid out independently by App.
 */
export function ConversationSurface({ tabId, currentDir }: { tabId: string; currentDir?: string }) {
  const composerOpen = useUiStore((state) => state.composerOpen);
  const launch = useUiStore((state) => state.conversationLaunch);
  const tab = useTabManagerStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const updateTabConversation = useTabManagerStore((state) => state.updateTabConversation);
  const store = useMemo(() => getConversationStore(tabId), [tabId]);
  const workspaceNamespace = tab?.kind === 'remote'
    ? ['remote', tab.remoteHost?.source, tab.remoteHost?.id, tab.remoteHost?.alias, tab.remoteHost?.user, tab.remoteHost?.hostname, tab.remoteHost?.port]
      .map((value) => value || '')
      .join('\u0000')
    : 'local';
  const workspaceKey = conversationWorkspaceKey(currentDir || tab?.workspacePath, workspaceNamespace);
  const hydratedWorkspaceRef = useRef('');
  const handledLaunchRevisionRef = useRef(-1);
  const historyRefreshRevisionRef = useRef(0);
  const sessionsRefreshRevisionRef = useRef(0);

  useLayoutEffect(() => {
    if (sessionStore.getItem('hulala.composer.' + tabId) === 'open') useUiStore.getState().openConversation();
  }, [tabId]);
  useEffect(() => {
    sessionStore.setItem('hulala.composer.' + tabId, useUiStore.getState().composerOpen ? 'open' : 'closed');
  }, [composerOpen, tabId]);

  useLayoutEffect(() => {
    const hydrationKey = `${tabId}\u0000${workspaceKey}`;
    if (hydratedWorkspaceRef.current === hydrationKey) return;
    hydratedWorkspaceRef.current = hydrationKey;
    store.getState().bindWorkspace(workspaceKey, tab?.activeSessionId, tab?.openSessionIds);
  }, [store, tab?.activeSessionId, tab?.openSessionIds, tabId, workspaceKey]);

  useEffect(() => {
    if (!composerOpen) return;
    let disposed = false;
    const activeSessionId = store.getState().activeSessionId;
    const hasNewLaunchIntent = handledLaunchRevisionRef.current !== launch.revision;
    handledLaunchRevisionRef.current = launch.revision;
    const intent = hasNewLaunchIntent && launch.intent?.kind === 'session'
      ? launch.intent
      : {
        kind: 'workspace' as const,
        ...(activeSessionId ? { preferredSessionId: activeSessionId } : {}),
      };
    store.getState().setLoading(true);
    void openConversation(tabId, currentDir, intent)
      .then((result) => {
        if (!disposed) store.getState().applyOpen(result);
      })
      .catch((error) => {
        if (!disposed) {
          store.getState().setLoading(false);
          store.getState().setError(messageFor(error));
        }
      });
    return () => { disposed = true; };
  }, [composerOpen, currentDir, launch.intent, launch.revision, store, tabId]);

  useEffect(() => {
    let disposed = false;
    const dispose = window.hulala?.desktop.onEvent((payload) => {
      if (payload.tabId !== tabId) return;
      const event = store.getState().applyServerEvent(payload.event);
      if (!event) return;
      if (event.type === 'conversation.reset' && (!event.sessionId || event.sessionId === store.getState().activeSessionId)) {
        const sessionId = store.getState().activeSessionId;
        if (sessionId) {
          const requestedWorkspaceKey = store.getState().workspaceKey;
          const revision = ++historyRefreshRevisionRef.current;
          void loadConversationHistory(tabId, sessionId, undefined, 400)
            .then((snapshot) => {
              const current = store.getState();
              if (disposed
                || revision !== historyRefreshRevisionRef.current
                || current.workspaceKey !== requestedWorkspaceKey
                || current.activeSessionId !== sessionId) return;
              current.applyOpen({ sessionId, sessions: current.sessions, snapshot });
            })
            .catch(() => undefined);
        }
      }
      if (event.type === 'conversation.sessionsChanged' || event.type === 'conversation.reset') {
        const requestedWorkspaceKey = store.getState().workspaceKey;
        const revision = ++sessionsRefreshRevisionRef.current;
        void listConversations(tabId, currentDir)
          .then((result) => {
            if (disposed
              || revision !== sessionsRefreshRevisionRef.current
              || store.getState().workspaceKey !== requestedWorkspaceKey) return;
            store.getState().setSessions(result.items);
          })
          .catch(() => undefined);
      }
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [currentDir, store, tabId]);

  useEffect(() => {
    let disposed = false;
    const refresh = async (revision: number) => {
      const current = store.getState();
      const sessionId = current.activeSessionId;
      if (!sessionId) return;
      try {
        const snapshot = await loadConversationHistory(tabId, sessionId, undefined, 400);
        const next = store.getState();
        if (!disposed && next.activeSessionId === sessionId && next.resyncRevision === revision) next.applyOpen({ sessionId, sessions: next.sessions, snapshot });
      } catch (error) { if (!disposed) store.getState().setError(messageFor(error)); }
    };
    const unsubscribe = store.subscribe((next, previous) => { if (next.resyncRevision !== previous.resyncRevision) void refresh(next.resyncRevision); });
    return () => { disposed = true; unsubscribe(); };
  }, [store, tabId]);

  useEffect(() => {
    const state = store.getState();
    updateTabConversation(tabId, state.activeSessionId || undefined, state.openSessionIds);
    return store.subscribe((next) => {
      updateTabConversation(tabId, next.activeSessionId || undefined, next.openSessionIds);
    });
  }, [store, tabId, updateTabConversation]);

  return null;
}
