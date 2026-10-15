import type {
  ConversationContent,
  ConversationInteractionAnswer,
  ConversationModelSelectionInput,
  ConversationOpenResult,
  ConversationPromptInput,
  ConversationQueueUpdateInput,
  ConversationSession,
  ConversationSnapshot,
  OpenAICodexProviderAuthState,
  Workspace,
} from '@hulala/workbench-contracts';
import type {
  RecoveryBackupIdentity,
  RecoveryBackupInput,
  RecoveryBackupRecord,
} from '../../shared/recoveryBackup';

export type ModelReasoningControl = 'level' | 'toggle';

export type SshHostPayload = {
  id?: string;
  alias: string;
  hostname?: string;
  user?: string;
  port?: string;
  identityFile?: string;
  source?: string;
  authMethod?: 'agent' | 'keyFile' | 'password';
  credentialID?: string;
  hasPassword?: boolean;
  hasPassphrase?: boolean;
  credentialStorage?: 'system' | 'session';
};

export type ManualSshHostPayload = SshHostPayload & {
  hostname: string;
  user: string;
  authMethod: 'keyFile' | 'password';
  password?: string;
  passphrase?: string;
  rememberSecret?: boolean;
};

export type ModelEntry = {
  key: string;
  id: string;
  label?: string;
  enabled: boolean;
  provider: string;
  providerLabel?: string;
  reasoning: boolean;
  reasoningControl?: ModelReasoningControl;
  reasoningLevels?: string[];
  updatedAt?: number;
};

export type ProviderEntry = {
  label?: string;
  managed?: boolean;
  models: Array<Omit<ModelEntry, 'key' | 'provider' | 'providerLabel'>>;
};

export type ModelPreference = { thinkingLevel?: string };

export type ModelsConfig = {
  version: number;
  defaultModelKey: string | null;
  providers: Record<string, ProviderEntry>;
  models: ModelEntry[];
  modelPreferences?: Record<string, ModelPreference>;
  updatedAt: number;
};

export type HarnessRuntimeModel = {
  provider: string;
  providerName?: string;
  id: string;
  name: string;
  default?: boolean;
  thinkingLevels?: string[];
  defaultThinkingLevel?: string;
};

export type HarnessRuntimeDescriptor = { id: string; name: string; active?: boolean };

export type HarnessRuntimeState = {
  current: string;
  selection?: { runtime: string; provider?: string; model?: string; thinkingLevel?: string };
  runtimes?: HarnessRuntimeDescriptor[];
  models?: HarnessRuntimeModel[];
  modelError?: string;
};

export type HarnessSettingsSchema = {
  uid: number;
  refs: Record<string, {
    type: string;
    meta?: Record<string, unknown>;
    value?: unknown;
    list?: number[];
    dict?: Record<string, number>;
    inner?: number;
    sKey?: number;
  }>;
};

export type HarnessSettingsNamespace = {
  ns: string;
  schema: HarnessSettingsSchema;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies: 'live' | 'restart';
  secrets: Array<{ path: string[]; set: boolean }>;
  revision: number;
};

export type BrowserServiceInfo = import('@hulala/workbench-contracts/browser').BrowserServiceInfo;

// Temporary retained types for the local workspace store. No network sync API is exposed.
export type WorkspaceSyncPolicy = Record<string, never>;
export type WorkspaceStorageBinding = { enabled: false };

export type RemoteSessionInfo = {
  hostLabel: string;
  workspaceDir: string;
  instanceId: string;
  runtimeVersion: string;
  platform: string;
  arch: string;
};

export type ManagedWorkspaceCreateResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; code: string; message: string };

type SettingsState = {
  system?: Record<string, unknown>;
  user?: { version?: number; defaultWorkspacePath?: string | null; recentWorkspaces?: unknown };
  ui?: Record<string, unknown>;
  editor?: Record<string, unknown>;
  [key: string]: unknown;
};

export type WorkbenchPlatform = {
  kind: 'browser';
  getPath(name: string): Promise<string>;
  getHomeDir(): Promise<string>;
  getDefaultDir(): Promise<string>;
  localDirectoryPicker: {
    listDirectory(path: string): Promise<any>;
    statPath(path: string): Promise<any>;
    getSpecialDirectories(): Promise<any>;
    mkdir(path: string): Promise<any>;
    writeFile(path: string, content: string): Promise<any>;
  };
  exportMarkdownPdfToPath(payload: unknown): Promise<any>;
  getPdfExportDefaultPath(payload: { sourcePath?: string; currentDir?: string; isRemote?: boolean; workspaceViewId?: string }): Promise<any>;
  pdfExport: {
    getPayload(): Promise<any>;
    reportReady(layout?: { height: number; complete: boolean }): void;
    reportError(message: string): void;
  };
  clipboard: {
    writeText(value: string): Promise<void>;
    readImagePngBase64(): Promise<{ base64: string } | null>;
    readFilePaths(): Promise<string[]>;
  };
  collectLocalTreeImport(paths: string[]): Promise<any>;
  readLocalFileBinary(path: string): Promise<any>;
  revealInFileManager(path: string, workspaceViewId?: string): Promise<any>;
  openLocalFileWithSystemApp(path: string, workspaceViewId?: string): Promise<any>;
  backup: {
    stage(data: RecoveryBackupInput): void;
    flush(): Promise<unknown>;
    load(): Promise<RecoveryBackupRecord[]>;
    delete(identity: RecoveryBackupIdentity): Promise<unknown>;
  };
  ssh: {
    listHosts(): Promise<SshHostPayload[]>;
    saveHost(host: ManualSshHostPayload): Promise<SshHostPayload>;
    deleteHost(id: string): Promise<unknown>;
    pickIdentityFile(): Promise<{ canceled: boolean; path?: string }>;
  };
  remote: {
    connectSsh(host: SshHostPayload, tabId: string): Promise<RemoteSessionInfo>;
    disconnect(tabId?: string): Promise<unknown>;
    status(tabId: string): Promise<RemoteSessionInfo | null>;
  };
  desktop: {
    connect(tabId: string): Promise<{ instanceId: string }>;
    disconnect(tabId: string): Promise<unknown>;
    workspaceContext(tabId: string, path?: string): Promise<any>;
    workspaces: {
      createManaged(
        target: { kind: 'local' } | { kind: 'remote'; tabId: string },
        name: string,
      ): Promise<ManagedWorkspaceCreateResult>;
    };
    files: {
      stat(tabId: string, path: string): Promise<any>;
      readdir(tabId: string, path: string): Promise<any>;
      readText(tabId: string, path: string): Promise<any>;
      writeText(tabId: string, path: string, content: string, expectedVersion: string | null): Promise<{ version: string }>;
      mkdir(tabId: string, path: string): Promise<any>;
      delete(tabId: string, path: string): Promise<any>;
      move(tabId: string, from: string, to: string, copy?: boolean): Promise<any>;
      search(tabId: string, path: string, query: string, limit?: number, options?: { regex?: boolean; matchCase?: boolean; wholeWord?: boolean; includes?: string[]; excludes?: string[] }): Promise<any>;
    };
    resources: {
      handle(tabId: string, path: string): Promise<{ id: string; name: string; size: number; expiresAt: string; url: string }>;
      import(tabId: string, path: string, data: ArrayBuffer | Blob, contentType?: string, expectedVersion?: string | null, upload?: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }): Promise<{
        ok: true;
        resource: { id: string; name: string; size: number; expiresAt: string; url: string };
      }>;
    };
    commands: {
      start(tabId: string, input: { path?: string; command: string; cwd?: string; requestId?: string }): Promise<{ id: string }>;
      list(tabId: string): Promise<{ items: import('@hulala/workbench-contracts').CommandSummary[] }>;
      get(tabId: string, commandId: string): Promise<import('@hulala/workbench-contracts').CommandSnapshot>;
      write(tabId: string, commandId: string, data: string): Promise<unknown>;
      stop(tabId: string, commandId: string): Promise<any>;
    };
    git: {
      branches(tabId: string, path: string): Promise<any>;
      checkout(tabId: string, input: { path: string; branch: string; create?: boolean }): Promise<any>;
    };
    cron: {
      list(tabId: string): Promise<any>;
      create(tabId: string, task: unknown): Promise<any>;
      run(tabId: string, id: string, requestId?: string): Promise<any>;
      remove(tabId: string, id: string): Promise<unknown>;
      history(tabId: string, id: string, limit?: number): Promise<any>;
    };
    messenger: {
      list(tabId: string, includeArchived?: boolean): Promise<any>;
      reply(tabId: string, messageId: string, text: string, requestId?: string): Promise<any>;
      update(tabId: string, messageId: string, action: 'read' | 'archive'): Promise<any>;
    };
    conversation: {
      open(tabId: string, path: string | undefined, intent: { kind: 'workspace'; preferredSessionId?: string } | { kind: 'session'; sessionId: string }): Promise<ConversationOpenResult>;
      list(tabId: string, path?: string): Promise<{ items: ConversationSession[] }>;
      create(tabId: string, path?: string, agentPreset?: string): Promise<ConversationOpenResult>;
      history(tabId: string, sessionId: string, beforeSeq?: number, maxMessages?: number): Promise<ConversationSnapshot>;
      copySessionPath(tabId: string, sessionId: string): Promise<{ copied: true }>;
      send(tabId: string, sessionId: string, input: ConversationPromptInput): Promise<{ accepted: true }>;
      cancel(tabId: string, sessionId: string): Promise<{ accepted: true }>;
      fork(tabId: string, sessionId: string, atSeq?: number): Promise<{ sessionId: string }>;
      rename(tabId: string, sessionId: string, title: string): Promise<{ title: string; seq: number }>;
      archive(tabId: string, sessionId: string): Promise<{ archivedSessionIds: string[] }>;
      models(tabId: string, sessionId: string): Promise<any>;
      selectModel(tabId: string, sessionId: string, selection: ConversationModelSelectionInput): Promise<unknown>;
      selectAgentPreset(tabId: string, sessionId: string, agentPreset: string): Promise<{ agentPreset: string }>;
      updateQueue(tabId: string, sessionId: string, itemId: string, action: ConversationQueueUpdateInput): Promise<{ accepted: true }>;
      answerInteraction(tabId: string, interactionId: string, answer: ConversationInteractionAnswer): Promise<{ accepted: boolean }>;
      loadAttachment(tabId: string, sessionId: string, attachmentId: string): Promise<{ url: string }>;
      imageUploadUrl(tabId: string, sessionId: string, uploadId: string): string;
      uploadImage(tabId: string, sessionId: string, uploadId: string, file: Blob, name?: string, options?: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }): Promise<{ uploadId: string; image: { mediaType: string; name?: string; bytes: number; width: number; height: number }; url: string }>;
      discardImage(tabId: string, sessionId: string, uploadId: string): Promise<unknown>;
      listSkills(tabId: string, sessionId: string): Promise<{ items: Array<{ name: string; description: string; modelInvocable?: boolean }> }>;
      listCommands(tabId: string, sessionId: string): Promise<{ items: Array<{ name: string; description: string; input?: { hint: string; images?: boolean } }> }>;
      executeCommand(tabId: string, sessionId: string, line: string, images?: Array<{ mediaType: string; uploadId: string; name?: string }>): Promise<{
        matched: boolean;
        command?: { commandId: string; result: { kind: 'success' | 'error'; text?: string } };
      }>;
      listSubagents(tabId: string, sessionId: string): Promise<any>;
      listAgentPresets(tabId: string): Promise<any>;
    };
    onConnection(handler: (payload: { tabId: string; state: 'connected' | 'disconnected' }) => void): () => void;
    onEvent(handler: (payload: { tabId: string; event: Record<string, unknown> }) => void): () => void;
  };
  localPlugins: import('@hulala/plugin-sdk').LocalPluginBridge;
  harness: {
    getRuntimeState(sessionId?: string): Promise<HarnessRuntimeState>;
    selectRuntime(input: Record<string, unknown>): Promise<unknown>;
    providerAuth: {
      describeOpenAICodex(): Promise<OpenAICodexProviderAuthState>;
      startOpenAICodex(): Promise<OpenAICodexProviderAuthState>;
      answerOpenAICodex(attemptId: string, promptId: string, value: string): Promise<OpenAICodexProviderAuthState>;
      cancelOpenAICodex(attemptId: string): Promise<OpenAICodexProviderAuthState>;
      enableOpenAICodex(): Promise<OpenAICodexProviderAuthState>;
      signOutOpenAICodex(): Promise<OpenAICodexProviderAuthState>;
      openOpenAICodexAuthorizationPage(url: string): Promise<void>;
    };
    settings: {
      describe(): Promise<unknown>;
      mutate(payload: Record<string, unknown>): Promise<unknown>;
      openDocument(): Promise<unknown>;
    };
    llm: {
      providers(): Promise<unknown>;
      discoverModels(payload: Record<string, unknown>): Promise<unknown>;
    };
    credentials: {
      describe(refs: string[]): Promise<unknown>;
      set(ref: string, value: string): Promise<unknown>;
      unset(ref: string): Promise<unknown>;
    };
    agentPresets: {
      list(): Promise<unknown>;
      read(agentPreset: string): Promise<unknown>;
      copy(from: string, agentPreset: string, name?: string): Promise<unknown>;
      openDocument(agentPreset: string): Promise<unknown>;
      remove(agentPreset: string): Promise<unknown>;
    };
    listPlugins(): Promise<{ entries: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string }> }>;
  };
  window: {
    list(): Promise<any[]>;
    getBootstrap(): Promise<any>;
    updateWorkspaceTabsSession(session: unknown): Promise<unknown>;
    createNew(): Promise<unknown>;
    completeNewWindowLanding(): Promise<{ success: boolean }>;
    createLocal(options?: { path?: string }): Promise<unknown>;
    createRemote(host: SshHostPayload): Promise<unknown>;
    focus(windowId: number): Promise<unknown>;
    close(windowId: number): Promise<unknown>;
    readyToClose?(): Promise<unknown>;
    onListChanged(handler: (windows: any[]) => void): () => void;
    onActiveChanged(handler: (payload: { active: boolean }) => void): () => void;
    onPrepareClose?(handler: () => void): () => void;
  };
  serviceInfo: {
    get(): Promise<BrowserServiceInfo>;
    onChanged(handler: (state: BrowserServiceInfo) => void): () => void;
  };
  settings: {
    get(): Promise<any>;
    getRoot(): Promise<string>;
    getDefaultWorkspace(): Promise<{
      configuredPath: string | null;
      defaultPath: string;
      effectivePath: string;
    }>;
    pickDefaultWorkspace(): Promise<{ canceled: boolean; path?: string }>;
    set(patch: unknown): Promise<SettingsState>;
    previewMarkdownTextOffset(value: number): void;
    previewMarkdownContentWidth(value: number): void;
    onChanged(handler: (settings: SettingsState) => void): () => void;
  };
  platform: NodeJS.Platform;
  isDev: boolean;
};

declare global {
  interface Window {
    hulala?: WorkbenchPlatform;
  }
}

export {};
