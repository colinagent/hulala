export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type FileChange = { type: 'created' | 'changed' | 'deleted'; path: string };

export type MessengerMessageNotification = {
  id: string;
  channelID: string;
  threadID: string;
  agentID: string;
  sender: 'user' | 'agent' | 'system';
  kind: 'message' | 'request' | 'status';
  status: 'open' | 'resolved' | 'archived';
  title?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

export type ConnectionCallbacks = {
  onStateChange?: (state: ConnectionState) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onFileChange?: (changes: FileChange[]) => void;
  onMessengerMessage?: (message: MessengerMessageNotification) => void;
};

type ServerMessage = {
  id: string;
  workspaceId: string;
  threadId: string | null;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export function toMessengerRecord(message: ServerMessage): MessengerMessageNotification {
  return {
    id: message.id,
    channelID: message.threadId || message.id,
    threadID: message.threadId || '',
    agentID: 'harness',
    sender: message.kind === 'user-reply' ? 'user' : message.kind.includes('error') ? 'system' : 'agent',
    kind: 'message',
    status: message.archivedAt ? 'archived' : message.readAt ? 'resolved' : 'open',
    title: message.title,
    body: message.body,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    meta: { workspaceId: message.workspaceId, sourceKind: message.kind },
  };
}

export class DesktopConnection {
  private callbacks: ConnectionCallbacks = {};
  private disconnectEvent?: () => void;
  private disconnectState?: () => void;
  private disposed = false;
  private suspended = false;
  private reconnectTimer?: number;
  private _state: ConnectionState = 'disconnected';
  private connecting?: Promise<void>;

  private readonly pageRestored = (event: PageTransitionEvent) => {
    if (event.persisted && !this.disposed && !this.suspended) void this.forceReconnect().catch(() => undefined);
  };

  constructor(readonly tabId: string) {
    window.addEventListener('pageshow', this.pageRestored);
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.callbacks.onStateChange?.(state);
  }

  async connect(callbacks: ConnectionCallbacks): Promise<void> {
    this.callbacks = callbacks;
    if (this.disposed || this._state === 'connected') return;
    if (this.connecting) return this.connecting;
    const work = this.connectOnce();
    this.connecting = work;
    try { await work; } finally { if (this.connecting === work) this.connecting = undefined; }
  }

  private async connectOnce(): Promise<void> {
    if (this.disposed) return;
    this.suspended = false;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const api = window.hulala?.desktop;
    if (!api) throw new Error('Hulala Desktop API is unavailable');
    this.disconnectEvent?.();
    this.disconnectState?.();
    this.disconnectState = api.onConnection((payload) => {
      if (payload.tabId !== this.tabId) return;
      this.setState(payload.state);
      if (payload.state === 'connected') this.callbacks.onConnect?.();
      else {
        this.callbacks.onDisconnect?.();
        if (!this.disposed && !this.suspended) {
          this.setState('reconnecting');
          this.reconnectTimer = window.setTimeout(() => void this.connect(this.callbacks).catch(() => undefined), 1_000);
        }
      }
    });
    this.disconnectEvent = api.onEvent((payload) => {
      if (payload.tabId !== this.tabId) return;
      void this.handleEvent(payload.event);
    });
    this.setState('connecting');
    try {
      await api.connect(this.tabId);
    } catch (error) {
      if (!this.disposed && !this.suspended) {
        this.setState('reconnecting');
        this.callbacks.onDisconnect?.();
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => void this.connect(this.callbacks).catch(() => undefined), 2_000);
      }
      throw error;
    }
  }

  async forceReconnect(): Promise<void> {
    this.suspended = false;
    await window.hulala?.desktop.disconnect(this.tabId);
    await this.connect(this.callbacks);
  }

  suspend(): void {
    this.suspended = true;
    void window.hulala?.desktop.disconnect(this.tabId);
    this.setState('disconnected');
  }

  resume(): void {
    this.suspended = false;
    void this.connect(this.callbacks);
  }

  disconnect(): void {
    this.suspended = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    void window.hulala?.desktop.disconnect(this.tabId);
    this.setState('disconnected');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pageshow', this.pageRestored);
    this.disconnect();
    this.disconnectEvent?.();
    this.disconnectState?.();
    this.disconnectEvent = undefined;
    this.disconnectState = undefined;
    this.callbacks = {};
  }

  isConnected(): boolean {
    return this._state === 'connected';
  }

  private async handleEvent(event: Record<string, unknown>): Promise<void> {
    if (event.type === 'filesystem.changed' && Array.isArray(event.paths)) {
      this.callbacks.onFileChange?.(event.paths.filter((value): value is string => typeof value === 'string').map((path) => ({ type: 'changed', path })));
      return;
    }
    if (event.type === 'messenger.changed' && typeof event.messageId === 'string') {
      const result = await window.hulala?.desktop.messenger.list(this.tabId, true) as { items?: ServerMessage[] } | undefined;
      const message = result?.items?.find((candidate) => candidate.id === event.messageId);
      if (message) this.callbacks.onMessengerMessage?.(toMessengerRecord(message));
    }
  }
}
