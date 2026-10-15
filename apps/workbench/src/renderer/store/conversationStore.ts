import type {
  ConversationDelta,
  ConversationSession,
  ConversationSnapshot,
  PendingInteraction,
  ServerEvent,
} from '@hulala/workbench-contracts';
import { applyConversationDelta, serverEventSchema } from '@hulala/workbench-contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

const MAX_ITEMS = 600;

export type ConversationActivityPanelState = {
  expanded: boolean;
  userOverride: 'expanded' | 'collapsed' | null;
};

const DEFAULT_ACTIVITY_PANEL_STATE: ConversationActivityPanelState = {
  expanded: false,
  userOverride: null,
};

type ConversationState = {
  workspaceKey: string | null;
  activeSessionId: string | null;
  openSessionIds: string[];
  sessions: ConversationSession[];
  snapshots: Record<string, ConversationSnapshot>;
  drafts: Record<string, string>;
  activityPanels: Record<string, ConversationActivityPanelState>;
  historicalSessionIds: string[];
  loading: boolean;
  loadingOlder: boolean;
  resyncRevision: number;
  error: string | null;
  setLoading(loading: boolean): void;
  setLoadingOlder(loading: boolean): void;
  setError(error: string | null): void;
  bindWorkspace(workspaceKey: string, activeSessionId?: string, openSessionIds?: string[]): void;
  applyOpen(result: { sessionId: string; sessions: ConversationSession[]; snapshot: ConversationSnapshot }): void;
  setSessions(sessions: ConversationSession[]): void;
  selectSession(sessionId: string): void;
  closeSession(sessionId: string): void;
  setDraft(sessionId: string, draft: string): void;
  setActivityExpanded(sessionId: string, expanded: boolean, options?: { userAction?: boolean }): void;
  prependHistory(snapshot: ConversationSnapshot): void;
  applyServerEvent(event: unknown): ServerEvent | null;
  removeSession(sessionId: string): void;
};

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

export function conversationWorkspaceKey(path: string | undefined, namespace = ''): string {
  const normalized = (path || '').trim().replace(/\\/g, '/');
  const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  const pathKey = /^[A-Za-z]:\//.test(withoutTrailingSlash)
    ? withoutTrailingSlash.toLowerCase()
    : withoutTrailingSlash;
  return namespace ? `${namespace}\u0000${pathKey}` : pathKey;
}

function applyChanges(snapshot: ConversationSnapshot, changes: ConversationDelta[], seq: number): ConversationSnapshot {
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  for (const change of changes) applyConversationDelta(items, change);
  const nextItems = [...items.values()]
    .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    .slice(-MAX_ITEMS);
  return { ...snapshot, items: nextItems, lastSeq: Math.max(snapshot.lastSeq, seq) };
}

export function createConversationStore(): StoreApi<ConversationState> {
  let recentEvents: ServerEvent[] = [];
  let replaying = false;
  let latestEpoch: string | undefined;
  const discardedThrough = new Map<string, number>();
  const baselines = new Map<string, { epoch: string; seq: number }>();
  return createStore<ConversationState>((set, get) => ({
    workspaceKey: null,
    activeSessionId: null,
    openSessionIds: [],
    sessions: [],
    snapshots: {},
    drafts: {},
    activityPanels: {},
    historicalSessionIds: [],
    loading: false,
    loadingOlder: false,
    resyncRevision: 0,
    error: null,
    setLoading: (loading) => set({ loading }),
    setLoadingOlder: (loadingOlder) => set({ loadingOlder }),
    setError: (error) => set({ error }),
    bindWorkspace: (workspaceKey, activeSessionId, openSessionIds = []) => set((state) => {
      if (state.workspaceKey === workspaceKey) return state;
      const restoringInitialWorkspace = state.workspaceKey === null;
      const restoredActiveSessionId = restoringInitialWorkspace ? activeSessionId : undefined;
      return {
        workspaceKey,
        activeSessionId: restoredActiveSessionId || null,
        openSessionIds: restoringInitialWorkspace
          ? unique([...(openSessionIds || []), ...(restoredActiveSessionId ? [restoredActiveSessionId] : [])])
          : [],
        sessions: [],
        snapshots: {},
        drafts: {},
        activityPanels: {},
        historicalSessionIds: [],
        loading: true,
        loadingOlder: false,
        error: null,
      };
    }),
    applyOpen: (result) => {
      const cursor = result.snapshot.transportCursor;
      if (cursor && ((latestEpoch && cursor.epoch !== latestEpoch) || (discardedThrough.get(result.sessionId) ?? -1) > cursor.seq)) {
        // An old HTTP response cannot replace frames no longer available for replay.
        set(state => ({ activeSessionId: result.sessionId, loading: true, resyncRevision: state.resyncRevision + 1 }));
        return;
      }
      const baseline = baselines.get(result.sessionId);
      if (cursor && baseline?.epoch === cursor.epoch && baseline.seq > cursor.seq) { get().selectSession(result.sessionId); return; }
      if (cursor) { latestEpoch = cursor.epoch; baselines.set(result.sessionId, cursor); }
      const replay = cursor ? recentEvents.filter(event => event.transportCursor?.epoch === cursor.epoch
        && event.transportCursor.seq > cursor.seq && 'sessionId' in event && event.sessionId === result.sessionId) : [];
      set((state) => {
      const valid = new Set(result.sessions.filter(session => !session.archived).map(session => session.sessionId));
      valid.add(result.sessionId);
      return {
        activeSessionId: result.sessionId,
        openSessionIds: unique([...state.openSessionIds, result.sessionId]).filter(id => valid.has(id)),
        sessions: result.sessions,
        snapshots: { ...state.snapshots, [result.sessionId]: result.snapshot },
        activityPanels: state.activityPanels[result.sessionId]
          ? state.activityPanels
          : { ...state.activityPanels, [result.sessionId]: DEFAULT_ACTIVITY_PANEL_STATE },
        historicalSessionIds: state.historicalSessionIds.filter(id => id !== result.sessionId),
        loading: false,
        error: null,
      };
      });
      replaying = true;
      try { for (const event of replay) get().applyServerEvent(event); }
      finally { replaying = false; }
    },
    setSessions: (sessions) => set({ sessions }),
    selectSession: (sessionId) => set((state) => ({
      activeSessionId: sessionId,
      openSessionIds: unique([...state.openSessionIds, sessionId]),
    })),
    closeSession: (sessionId) => set((state) => {
      const openSessionIds = state.openSessionIds.filter(id => id !== sessionId);
      return {
        openSessionIds,
        activeSessionId: state.activeSessionId === sessionId ? openSessionIds.at(-1) ?? null : state.activeSessionId,
      };
    }),
    setDraft: (sessionId, draft) => set((state) => ({ drafts: { ...state.drafts, [sessionId]: draft } })),
    setActivityExpanded: (sessionId, expanded, options) => set((state) => {
      const previous = state.activityPanels[sessionId] ?? DEFAULT_ACTIVITY_PANEL_STATE;
      return {
        activityPanels: {
          ...state.activityPanels,
          [sessionId]: {
            expanded,
            userOverride: options?.userAction
              ? (expanded ? 'expanded' : 'collapsed')
              : previous.userOverride,
          },
        },
      };
    }),
    prependHistory: (snapshot) => set((state) => {
      const current = state.snapshots[snapshot.session.sessionId];
      if (!current) return { snapshots: { ...state.snapshots, [snapshot.session.sessionId]: snapshot }, loadingOlder: false };
      const items = new Map([...snapshot.items, ...current.items].map(item => [item.id, item]));
      const ordered = [...items.values()].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id));
      const viewingHistory = ordered.length > MAX_ITEMS;
      const merged = ordered.slice(0, MAX_ITEMS);
      return {
        loadingOlder: false,
        historicalSessionIds: viewingHistory
          ? unique([...state.historicalSessionIds, snapshot.session.sessionId])
          : state.historicalSessionIds,
        snapshots: {
          ...state.snapshots,
          [snapshot.session.sessionId]: {
            ...current,
            items: merged,
            hasMore: snapshot.hasMore,
            firstSeq: snapshot.firstSeq,
          },
        },
      };
    }),
    applyServerEvent: (value) => {
      const parsed = serverEventSchema.safeParse(value);
      if (!parsed.success) {
        set({ error: 'Invalid conversation update received. Reopen this chat to refresh its history.' });
        return null;
      }
      const event = parsed.data;
      if (!replaying && event.transportCursor && event.type.startsWith('conversation.')) {
        if (latestEpoch !== event.transportCursor.epoch) { recentEvents = []; discardedThrough.clear(); baselines.clear(); }
        latestEpoch = event.transportCursor.epoch;
        if (event.type !== 'conversation.reset') {
          recentEvents.push(event);
          if (recentEvents.length > 2048) for (const dropped of recentEvents.splice(0, recentEvents.length - 2048)) {
            if ('sessionId' in dropped && dropped.sessionId && dropped.transportCursor) discardedThrough.set(dropped.sessionId, dropped.transportCursor.seq);
          }
        }
      }
      set((state) => {
        if (event.type === 'conversation.reset') {
          const snapshots = { ...state.snapshots };
          if (event.sessionId) { delete snapshots[event.sessionId]; baselines.delete(event.sessionId); }
          else baselines.clear();
          // Keep the active view visible while its replacement snapshot loads.
          // Inactive sessions must reload when selected after reconnecting.
          const active = state.activeSessionId && state.snapshots[state.activeSessionId];
          if (event.sessionId === state.activeSessionId && active) snapshots[state.activeSessionId!] = active;
          return { snapshots: event.sessionId ? snapshots : active ? { [state.activeSessionId!]: active } : {}, historicalSessionIds: [] };
        }
        const sessionId = 'sessionId' in event ? event.sessionId : undefined;
        const currentCursor = sessionId ? state.snapshots[sessionId]?.transportCursor : undefined;
        const cursor = event.transportCursor;
        if (cursor && currentCursor && (cursor.epoch !== currentCursor.epoch || cursor.seq <= currentCursor.seq)) return {};
        const patch: Partial<ConversationState> = (() => {
        if (event.type === 'conversation.delta') {
          if (state.historicalSessionIds.includes(event.sessionId)) return {};
          const snapshot = state.snapshots[event.sessionId];
          if (snapshot && !event.transient && event.seq <= snapshot.lastSeq) return {};
          return snapshot ? { snapshots: { ...state.snapshots, [event.sessionId]: applyChanges(snapshot, event.changes, event.transient ? snapshot.lastSeq : event.seq) } } : {};
        }
        if (event.type === 'conversation.status') {
          const sessions = state.sessions.map(session => session.sessionId === event.sessionId
            ? { ...session, running: event.running, ...(event.blank === undefined ? {} : { blank: event.blank }) }
            : session);
          const snapshot = state.snapshots[event.sessionId];
          return {
            sessions,
            ...(snapshot ? {
              snapshots: {
                ...state.snapshots,
                [event.sessionId]: { ...snapshot, session: { ...snapshot.session, running: event.running, ...(event.blank === undefined ? {} : { blank: event.blank }) } },
              },
            } : {}),
          };
        }
        if (event.type === 'conversation.queue') {
          const snapshot = state.snapshots[event.sessionId];
          return snapshot ? { snapshots: { ...state.snapshots, [event.sessionId]: { ...snapshot, queue: event.items } } } : {};
        }
        if (event.type === 'conversation.projection') {
          const snapshot = state.snapshots[event.sessionId];
          return snapshot ? {
            snapshots: {
              ...state.snapshots,
              [event.sessionId]: {
                ...snapshot,
                projections: {
                  asOfSeq: Math.max(snapshot.projections.asOfSeq, event.seq),
                  values: { ...snapshot.projections.values, [event.key]: event.value },
                },
              },
            },
          } : {};
        }
        if (event.type === 'conversation.interaction') {
          const snapshot = state.snapshots[event.sessionId];
          if (!snapshot) return {};
          let pendingInteractions = snapshot.pendingInteractions;
          if (event.resolvedInteractionId) {
            pendingInteractions = pendingInteractions.filter(item => item.interactionId !== event.resolvedInteractionId);
          } else if (event.interaction) {
            pendingInteractions = [
              ...pendingInteractions.filter(item => item.interactionId !== event.interaction?.interactionId),
              event.interaction,
            ] as PendingInteraction[];
          } else {
            pendingInteractions = [];
          }
          return { snapshots: { ...state.snapshots, [event.sessionId]: { ...snapshot, pendingInteractions } } };
        }
        return {};
        })();
        if (cursor && sessionId && patch.snapshots?.[sessionId]) {
          patch.snapshots = { ...patch.snapshots, [sessionId]: { ...patch.snapshots[sessionId], transportCursor: cursor } };
        }
        return patch;
      });
      return event;
    },
    removeSession: (sessionId) => {
      get().closeSession(sessionId);
      set((state) => {
        const snapshots = { ...state.snapshots };
        const drafts = { ...state.drafts };
        const activityPanels = { ...state.activityPanels };
        delete snapshots[sessionId];
        delete drafts[sessionId];
        delete activityPanels[sessionId];
        return {
          snapshots,
          drafts,
          activityPanels,
          sessions: state.sessions.filter(item => item.sessionId !== sessionId),
          historicalSessionIds: state.historicalSessionIds.filter(id => id !== sessionId),
        };
      });
    },
  }));
}

const stores = new Map<string, StoreApi<ConversationState>>();

export function getConversationStore(tabId: string): StoreApi<ConversationState> {
  const existing = stores.get(tabId);
  if (existing) return existing;
  const created = createConversationStore();
  stores.set(tabId, created);
  return created;
}

export function removeConversationStore(tabId: string): void {
  stores.delete(tabId);
}

export function useConversationStore<T>(tabId: string, selector: (state: ConversationState) => T): T {
  return useStore(getConversationStore(tabId), selector);
}
